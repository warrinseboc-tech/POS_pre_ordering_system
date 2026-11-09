"""Registration-only email verification; codes never leave the mail transport."""
import hashlib
import hmac
import secrets
import json
import os
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import click
from datetime import timedelta

from flask import abort, current_app, request, session

from .common import now
from .db import execute, rows, transaction


def register_email_commands(app):
    @app.cli.command('check-email')
    def check_email():
        """Check Resend configuration without sending a message."""
        missing = [key for key in ('RESEND_API_KEY', 'EMAIL_FROM') if not os.getenv(key)]
        if missing:
            raise click.ClickException('Missing environment variables: ' + ', '.join(missing))
        click.echo('Resend settings present. No email sent; domain and API key not validated.')


def digest(value):
    return hmac.new(current_app.secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()


def rate_limit(action, limit):
    bucket = digest(f'otp:{action}:{request.remote_addr}')
    blocked = False
    with transaction():
        execute('INSERT INTO login_attempts(bucket,attempts,expires_at) VALUES(%s,0,%s) ON CONFLICT DO NOTHING',
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


class EmailDeliveryError(Exception):
    pass


def send_code(email, code, purpose='registration'):
    api_key = os.getenv('RESEND_API_KEY', '').strip()
    sender = os.getenv('EMAIL_FROM', '').strip()
    if not api_key or not sender:
        raise EmailDeliveryError('RESEND_API_KEY or EMAIL_FROM is missing.')

    if purpose == 'password':
        subject = 'ISTILO Coffee Shop - Password Change Verification'
        body = (f'Use this code to confirm your ISTILO password change: {code}\n'
                'This code expires in 5 minutes.\n'
                'If you did not request a password change, ignore this email. '
                'Your password has not changed.\nISTILO Coffee Shop\n')
    else:
        subject = 'ISTILO Coffee Shop - Email Verification'
        body = (f'Welcome to ISTILO Coffee Shop!\n'
                'Thank you for creating an account.\n'
                f'Your verification code is:\n{code}\n'
                'This code expires in 5 minutes.\n'
                'If you did not register an account, please ignore this email.\n'
                'ISTILO Coffee Shop\n')

    payload = json.dumps({'from': sender, 'to': [email],
                          'subject': subject, 'text': body}).encode('utf-8')
    req = Request('https://api.resend.com/emails', data=payload,
                  headers={'Authorization': 'Bearer ' + api_key,
                           'Content-Type': 'application/json'}, method='POST')
    try:
        with urlopen(req, timeout=15) as response:
            if response.status not in (200, 201, 202):
                raise EmailDeliveryError(f'Resend returned HTTP {response.status}')
    except HTTPError as exc:
        detail = exc.read(500).decode('utf-8', errors='replace')
        raise EmailDeliveryError(f'Resend rejected email (HTTP {exc.code}): {detail}') from exc
    except (URLError, OSError) as exc:
        raise EmailDeliveryError(f'Resend connection failed ({type(exc).__name__})') from exc


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
        send_code(email, code, purpose)
    except EmailDeliveryError as error:
        # Abort preserves the existing transaction rollback on failed delivery.
        current_app.logger.error('Verification email delivery failed: %s', error)
        abort(503, description='Could not send the verification email. Please try again shortly.')


def pending_registration():
    token = session.get('registration_token', '')
    email = session.get('registration_email', '')
    entry = rows('SELECT * FROM pending_account_verifications WHERE user_email=%s FOR UPDATE',
                 (email,), one=True)
    if not token or not entry or not hmac.compare_digest(entry['registration_token_hash'], digest(token)):
        abort(400, description='Return to registration to start email verification.')
    return entry
