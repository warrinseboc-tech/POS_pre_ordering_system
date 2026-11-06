import hashlib
import hmac
import re
from datetime import timedelta

from flask import Blueprint, abort, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from .common import actor, iso, now, payload, text
from .db import execute, rows, transaction

auth = Blueprint('auth', __name__)


def customer_json(account):
    return dict(id=account['user_id'], email=account['user_email'], phone=account['phone'], verified=bool(account['email_verified'])) if account else None


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
        execute('INSERT IGNORE INTO login_attempts(bucket,attempts,expires_at) VALUES(%s,0,%s)', (bucket, now() + timedelta(minutes=15)))
        attempt = rows('SELECT * FROM login_attempts WHERE bucket=%s FOR UPDATE', (bucket,), one=True)
        if attempt['expires_at'] < now():
            execute('UPDATE login_attempts SET attempts=0,expires_at=%s WHERE bucket=%s', (now() + timedelta(minutes=15), bucket))
            attempt['attempts'] = 0
        if attempt['attempts'] >= 10:
            abort(429, description='Too many sign-in attempts. Try again in 15 minutes.')
        user = rows('SELECT * FROM users WHERE employee_id=%s AND role=%s AND active=1', (employee, role), one=True)
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
    data = request.get_json(silent=True) if request.is_json else request.form.to_dict()
    email = text(data.get('email', ''), 255, True).lower()
    phone = text(data.get('phone', ''), 20, True)
    password = text(data.get('password', ''), 200, True)
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        abort(400, description='Enter a valid email address.')
    if len(password) < 8:
        abort(400, description='Use a password with at least 8 characters.')
    if not re.fullmatch(r'[0-9+\-\s]{7,20}', phone):
        abort(400, description='Enter a valid phone number.')
    with transaction():
        existing = rows('SELECT user_id FROM accounts WHERE user_email=%s OR phone=%s LIMIT 1',
                        (email, phone), one=True)
        if existing:
            abort(409, description='An account with that email or phone already exists.')
        execute('INSERT INTO accounts(password,user_email,phone,email_verified) VALUES(%s,%s,%s,1)',
                (generate_password_hash(password), email, phone))
        account = rows('SELECT * FROM accounts WHERE user_email=%s', (email,), one=True)
    session['customer_id'] = account['user_id']
    session['customer_email'] = account['user_email']
    session['customer_verified'] = True
    return jsonify(user=customer_json(account), csrf=session['csrf']), 201


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
