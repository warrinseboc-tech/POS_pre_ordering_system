"""Registration-only email verification; codes never leave the mail transport."""
import hashlib
import hmac
import secrets
import smtplib
import ssl
from datetime import timedelta
from email.message import EmailMessage

from flask import abort, current_app, request, session

from .common import now
from .db import execute, rows, transaction


def digest(value):
    return hmac.new(current_app.secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()


def rate_limit(action, limit):
    bucket = digest(f'otp:{action}:{request.remote_addr}')
    blocked = False
    with transaction():
        execute('INSERT IGNORE INTO login_attempts(bucket,attempts,expires_at) VALUES(%s,0,%s)',
                (bucket, now() + timedelta(minutes=15)))
        entry = rows('SELECT * FROM login_attempts WHERE bucket=%s FOR UPDATE', (bucket,), one=True)
        if entry['expires_at'] <= now():
            execute('UPDATE login_attempts SET attempts=0,expires_at=%s WHERE bucket=%s',
                    (now() + timedelta(minutes=15), bucket))
            entry['attempts'] = 0
        blocked = entry['attempts'] >= limit
        if not blocked:
            execute('UPDATE login_attempts SET attempts=attempts+1 WHERE bucket=%s', (bucket,))
    if blocked:
        abort(429, description='Too many verification requests. Try again in 15 minutes.')


def send_code(email, code, purpose='registration'):
    config = current_app.config
    missing = [key for key in ('SMTP_HOST', 'SMTP_USERNAME', 'SMTP_PASSWORD') if not config.get(key)]
    if missing:
        current_app.logger.error('Email delivery configuration missing: %s', ', '.join(missing))
        raise RuntimeError('Email delivery is not configured. Ask the shop to check its SMTP settings.')
    message = EmailMessage()
    message['Subject'] = 'ISTILO Coffee Shop - Password Change Verification' if purpose == 'password' else 'ISTILO Coffee Shop - Email Verification'
    message['From'] = config['SMTP_FROM'] or config['SMTP_USERNAME']
    message['To'] = email
    message.set_content(f'''Welcome to ISTILO Coffee Shop!
Thank you for creating an account.
Your verification code is:
{code}
This code expires in 5 minutes.
If you did not register an account, please ignore this email.
ISTILO Coffee Shop
''')
    if purpose == 'password':
        message.set_content(f'Use this code to confirm your ISTILO password change: {code}\n'
                            'This code expires in 5 minutes.\n'
                            'If you did not request a password change, ignore this email. Your password has not changed.\nISTILO Coffee Shop\n')
    transport = smtplib.SMTP_SSL if config['SMTP_SSL'] else smtplib.SMTP
    options = {'context': ssl.create_default_context()} if config['SMTP_SSL'] else {}
    with transport(config['SMTP_HOST'], config['SMTP_PORT'], timeout=15, **options) as smtp:
        if not config['SMTP_SSL']:
            smtp.starttls(context=ssl.create_default_context())
        if config['SMTP_USERNAME']:
            smtp.login(config['SMTP_USERNAME'], config['SMTP_PASSWORD'])
        smtp.send_message(message)


def issue_code(email, token):
    previous = rows('SELECT otp_hash FROM pending_account_verifications WHERE user_email=%s', (email,), one=True)
    code = f'{secrets.randbelow(1000000):06d}'
    while previous and hmac.compare_digest(previous['otp_hash'], digest(email + ':' + code)):
        code = f'{secrets.randbelow(1000000):06d}'
    execute('UPDATE pending_account_verifications SET otp_hash=%s,registration_token_hash=%s,'
            'expires_at=%s,attempts=0,last_sent_at=%s WHERE user_email=%s',
            (digest(email + ':' + code), digest(token), now() + timedelta(minutes=5), now(), email))
    deliver_code(email, code)


def deliver_code(email, code, purpose='registration'):
    try:
        if purpose == 'registration':
            send_code(email, code)
        else:
            send_code(email, code, purpose)
    except RuntimeError as error:
        abort(503, description=str(error))
    except smtplib.SMTPAuthenticationError:
        current_app.logger.error('Verification email failed: SMTP authentication rejected. Check SMTP_USERNAME and SMTP_PASSWORD.')
        abort(503, description='The email provider rejected the sender login. Ask the shop to check its SMTP settings.')
    except (OSError, smtplib.SMTPException) as error:
        # Raising here rolls back the pending account/code, including failed resends.
        current_app.logger.error('Verification email delivery failed (%s).', type(error).__name__)
        abort(503, description='Could not send the verification email. Please try again shortly.')


def pending_registration():
    token = session.get('registration_token', '')
    email = session.get('registration_email', '')
    entry = rows('SELECT * FROM pending_account_verifications WHERE user_email=%s FOR UPDATE',
                 (email,), one=True)
    if not token or not entry or not hmac.compare_digest(entry['registration_token_hash'], digest(token)):
        abort(400, description='Return to registration to start email verification.')
    return entry
