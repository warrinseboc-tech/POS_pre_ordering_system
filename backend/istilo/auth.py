import hashlib
import hmac
import re
import secrets
from datetime import timedelta

from flask import Blueprint, abort, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from .common import payload, text, now
from .db import execute, rows, transaction
from .email_otp import digest, deliver_code, issue_code, pending_registration, rate_limit

auth = Blueprint('auth', __name__)


def valid_customer_password(password):
    return (
        len(password) >= 8
        and re.search(r'[A-Za-z]', password)
        and re.search(r'[0-9]', password)
        and re.search(r'[^A-Za-z0-9\s]', password)
    )


def customer_json(account):
    return dict(id=account['user_id'], name=account.get('name', ''), email=account['user_email'], phone=account['phone'], verified=bool(account['email_verified'])) if account else None


def user_json(user):
    return dict(id=user['id'], employeeId=user['employee_id'], name=user['name'], email=user['email'], role=user['role'], active=bool(user['active'])) if user else None


@auth.post('/auth/login')
def login():
    data = payload()
    role = data.get('role')
    if role not in ('admin', 'crew'):
        abort(400, description='Choose an account type.')
    employee = text(data.get('employee', ''), 40, True).upper()
    password = text(data.get('password', ''), 200, True)
    bucket = hashlib.sha256(f'{request.remote_addr}:{employee}'.encode()).hexdigest()
    with transaction():
        execute('INSERT INTO login_attempts(bucket,attempts,expires_at) VALUES(%s,0,%s) ON CONFLICT DO NOTHING', (bucket, now() + timedelta(minutes=15)))
        attempt = rows('SELECT * FROM login_attempts WHERE bucket=%s FOR UPDATE', (bucket,), one=True)
        if attempt['expires_at'] < now():
            execute('UPDATE login_attempts SET attempts=0,expires_at=%s WHERE bucket=%s', (now() + timedelta(minutes=15), bucket))
            attempt['attempts'] = 0
        if attempt['attempts'] >= 10:
            abort(429, description='Too many sign-in attempts. Try again in 15 minutes.')
        user = rows('SELECT * FROM users WHERE employee_id=%s AND role=%s AND active=TRUE', (employee, role), one=True)
        valid = bool(user and check_password_hash(user['password_hash'], password))
        if not valid:
            execute('UPDATE login_attempts SET attempts=attempts+1 WHERE bucket=%s', (bucket,))
        else:
            execute('DELETE FROM login_attempts WHERE bucket=%s', (bucket,))
    if not valid:
        abort(401, description='Invalid employee ID or password, or inactive account.')
    session[role + '_id'] = user['id']
    return jsonify(user=user_json(user), csrf=session['csrf'])


@auth.post('/auth/customer/login')
def customer_login():
    data = payload()
    identifier = text(data.get('identifier', ''), 255, True).lower()
    password = text(data.get('password', ''), 200, True)
    account = rows('SELECT * FROM accounts WHERE user_email=%s OR phone=%s LIMIT 1',
                   (identifier, data.get('identifier', '').strip()), one=True)
    valid = False
    if account:
        stored_password = account['password'] or ''
        try:
            valid = check_password_hash(stored_password, password)
        except (ValueError, TypeError):
            valid = False
        if not valid and stored_password and not stored_password.startswith(('scrypt:', 'pbkdf2:')):
            valid = hmac.compare_digest(stored_password, password)
            if valid:
                with transaction():
                    execute('UPDATE accounts SET password=%s WHERE user_id=%s',
                            (generate_password_hash(password), account['user_id']))
    if not account or not valid:
        abort(401, description='The email/phone or password is incorrect.')
    if not account['email_verified']:
        abort(403, description='Verify your email before signing in.')
    session['customer_id'] = account['user_id']
    session['customer_email'] = account['user_email']
    session['customer_verified'] = True
    return jsonify(user=customer_json(account), csrf=session['csrf'])


@auth.post('/auth/customer/register')
def customer_register():
    rate_limit('send', 10)
    data = payload()
    name = text(data.get('name', ''), 100, True)
    email = text(data.get('email', ''), 255, True).lower()
    phone = text(data.get('phone', ''), 20, True)
    password = text(data.get('password', ''), 200, True)
    if not name:
        abort(400, description='Enter your name.')
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        abort(400, description='Enter a valid email address.')
    if not valid_customer_password(password):
        abort(400, description='Password must be at least 8 characters and include a letter, number, and special character.')
    if data.get('terms') is not True:
        abort(400, description='You must agree to the Terms and Agreement.')
    if not re.fullmatch(r'[0-9]{12}', phone):
        abort(400, description='Phone number must contain exactly 12 digits.')
    token = secrets.token_urlsafe(32)
    with transaction():
        # Serialize matching phone registrations without changing legacy phone values.
        phone_lock = digest('registration-phone:' + phone)
        execute('INSERT INTO login_attempts(bucket,attempts,expires_at) VALUES(%s,0,%s) ON CONFLICT DO NOTHING',
                (phone_lock, now() + timedelta(minutes=15)))
        rows('SELECT bucket FROM login_attempts WHERE bucket=%s FOR UPDATE', (phone_lock,), one=True)
        existing = rows('SELECT user_id FROM accounts WHERE user_email=%s OR phone=%s LIMIT 1 FOR UPDATE',
                        (email, phone), one=True)
        if existing:
            abort(409, description='An account with that email or phone already exists.')
        execute('INSERT INTO accounts(password,name,user_email,phone,email_verified) VALUES(%s,%s,%s,%s,FALSE)',
                (generate_password_hash(password), name, email, phone))
        execute('INSERT INTO pending_account_verifications(user_email,phone,password_hash,otp_hash,expires_at,registration_token_hash) '
                'VALUES(%s,%s,%s,%s,%s,%s)', (email, phone, '', '', now(), digest(token)))
        issue_code(email, token)
    session['registration_token'] = token
    session['registration_email'] = email
    return jsonify(pending=True, resendAfter=60), 201


@auth.post('/auth/customer/verify-email')
def customer_verify_email():
    rate_limit('verify', 30)
    code = text(payload().get('code', ''), 6, True)
    error = None
    with transaction():
        entry = pending_registration()
        if entry['expires_at'] <= now():
            error = ('This verification code has expired. Resend a new code.', 400)
        elif entry['attempts'] >= 5:
            error = ('Too many incorrect attempts. Resend a new code.', 429)
        elif not re.fullmatch(r'[0-9]{6}', code) or not hmac.compare_digest(entry['otp_hash'], digest(entry['user_email'] + ':' + code)):
            execute('UPDATE pending_account_verifications SET attempts=attempts+1 WHERE user_email=%s', (entry['user_email'],))
            error = ('Incorrect verification code.', 400)
        else:
            execute('UPDATE accounts SET email_verified=TRUE WHERE user_email=%s', (entry['user_email'],))
            execute('DELETE FROM pending_account_verifications WHERE user_email=%s', (entry['user_email'],))
    if error:
        abort(error[1], description=error[0])
    session.pop('registration_token', None)
    session.pop('registration_email', None)
    return jsonify(message='Email verified successfully!')


@auth.post('/auth/customer/resend-otp')
def customer_resend_otp():
    rate_limit('send', 10)
    with transaction():
        entry = pending_registration()
        remaining = 60 - (now() - entry['last_sent_at']).total_seconds()
        if remaining > 0:
            return jsonify(error='Wait before requesting another code.', resendAfter=int(remaining) + 1), 429
        issue_code(entry['user_email'], session['registration_token'])
    return jsonify(pending=True, resendAfter=60)


@auth.get('/auth/customer/registration-status')
def customer_registration_status():
    if not session.get('registration_token'):
        return jsonify(pending=False)
    with transaction():
        entry = pending_registration()
        remaining = max(0, 60 - int((now() - entry['last_sent_at']).total_seconds()))
    return jsonify(pending=True, resendAfter=remaining)


@auth.post('/auth/customer/reset-password')
def customer_reset_password():
    rate_limit('password-send', 10)
    data = payload()
    identifier = text(data.get('identifier', ''), 255, True).lower()
    password = text(data.get('password', ''), 200, True)
    if not valid_customer_password(password):
        abort(400, description='Password must be at least 8 characters and include a letter, number, and special character.')
    account = rows('SELECT user_id,user_email FROM accounts WHERE user_email=%s OR phone=%s LIMIT 1',
                   (identifier, data.get('identifier', '').strip()), one=True)
    if not account:
        abort(404, description='No account matches that email or phone number.')
    token = secrets.token_urlsafe(32)
    with transaction():
        execute('INSERT INTO password_change_verifications(user_email,token_hash,password_hash,otp_hash,expires_at,last_sent_at) '
                'VALUES(%s,%s,%s,%s,%s,%s)', (account['user_email'], '', '', '', now(), now()-timedelta(seconds=61)))
        entry = rows('SELECT * FROM password_change_verifications WHERE user_email=%s FOR UPDATE', (account['user_email'],), one=True)
        remaining = 60 - (now()-entry['last_sent_at']).total_seconds()
        if remaining > 0:
            return jsonify(error='Wait before requesting another password code.', resendAfter=int(remaining)+1),429
        execute('UPDATE password_change_verifications SET token_hash=%s,password_hash=%s WHERE user_email=%s',
                (digest(token),generate_password_hash(password),account['user_email']))
        issue_password_code(account['user_email'], entry['otp_hash'])
    session['password_reset_token'] = token
    session['password_reset_email'] = account['user_email']
    return jsonify(pending=True,resendAfter=60)


def issue_password_code(email, previous_hash):
    code = f'{secrets.randbelow(1000000):06d}'
    while hmac.compare_digest(previous_hash,digest('password:'+email+':'+code)):
        code = f'{secrets.randbelow(1000000):06d}'
    execute('UPDATE password_change_verifications SET otp_hash=%s,expires_at=%s,last_sent_at=%s,attempts=0 WHERE user_email=%s',
            (digest('password:'+email+':'+code),now()+timedelta(minutes=5),now(),email))
    deliver_code(email,code,'password')


def pending_password_change():
    token=session.get('password_reset_token','')
    entry=rows('SELECT * FROM password_change_verifications WHERE user_email=%s FOR UPDATE',
               (session.get('password_reset_email',''),),one=True)
    if not token or not entry or not hmac.compare_digest(entry['token_hash'],digest(token)):
        abort(400,description='Request a new password change code from the password form.')
    return entry


@auth.post('/auth/customer/reset-password/verify')
def verify_password_change():
    rate_limit('password-verify',30)
    code=text(payload().get('code',''),6,True)
    error=None
    with transaction():
        entry=pending_password_change()
        if entry['expires_at'] <= now():
            error=('This code has expired. Resend a new code.',400)
        elif entry['attempts'] >= 5:
            error=('Too many incorrect attempts. Resend a new code.',429)
        elif not re.fullmatch(r'[0-9]{6}',code) or not hmac.compare_digest(entry['otp_hash'],digest('password:'+entry['user_email']+':'+code)):
            execute('UPDATE password_change_verifications SET attempts=attempts+1 WHERE user_email=%s',(entry['user_email'],))
            error=('Incorrect verification code.',400)
        else:
            execute('UPDATE accounts SET password=%s WHERE user_email=%s',(entry['password_hash'],entry['user_email']))
            execute('DELETE FROM password_change_verifications WHERE user_email=%s',(entry['user_email'],))
    if error:
        abort(error[1],description=error[0])
    for key in ('password_reset_token','password_reset_email','customer_id','customer_email','customer_verified'):
        session.pop(key,None)
    return jsonify(ok=True)


@auth.post('/auth/customer/reset-password/resend')
def resend_password_code():
    rate_limit('password-send',10)
    with transaction():
        entry=pending_password_change()
        remaining=60-(now()-entry['last_sent_at']).total_seconds()
        if remaining > 0:
            return jsonify(error='Wait before requesting another password code.',resendAfter=int(remaining)+1),429
        issue_password_code(entry['user_email'],entry['otp_hash'])
    return jsonify(pending=True,resendAfter=60)


@auth.patch('/auth/customer/profile')
def customer_update_profile():
    if not session.get('customer_id') or not session.get('customer_verified'):
        abort(401, description='Sign in to edit your profile.')
    data = payload()
    name = text(data.get('name', ''), 100, True)
    email = text(data.get('email', ''), 255, True).lower()
    phone = text(data.get('phone', ''), 20, True)
    if not name:
        abort(400, description='Enter your name.')
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        abort(400, description='Enter a valid email address.')
    if not re.fullmatch(r'[0-9+\-\s]{7,20}', phone):
        abort(400, description='Enter a valid phone number.')
    with transaction():
        existing = rows('SELECT user_id FROM accounts WHERE (user_email=%s OR phone=%s) AND user_id<>%s LIMIT 1',
                        (email, phone, session['customer_id']), one=True)
        if existing:
            abort(409, description='That email or phone is already used by another account.')
        execute('UPDATE accounts SET name=%s,user_email=%s,phone=%s WHERE user_id=%s',
                (name, email, phone, session['customer_id']))
        account = rows('SELECT * FROM accounts WHERE user_id=%s', (session['customer_id'],), one=True)
    session['customer_email'] = account['user_email']
    return jsonify(user=customer_json(account))


@auth.post('/auth/logout')
def logout():
    role = request.headers.get('X-Portal')
    if role == 'customer':
        session.pop('customer_id', None)
        session.pop('customer_email', None)
        session.pop('customer_verified', None)
        return jsonify(ok=True)
    if role not in ('admin', 'crew'):
        abort(400)
    session.pop(role + '_id', None)
    return jsonify(ok=True)
