import hashlib
from datetime import timedelta

from flask import Blueprint, abort, jsonify, request, session
from werkzeug.security import check_password_hash

from .common import actor, iso, now, payload, text
from .db import execute, rows, transaction

auth = Blueprint('auth', __name__)


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


@auth.post('/auth/logout')
def logout():
    role = request.headers.get('X-Portal')
    if role not in ('admin', 'crew'):
        abort(400)
    session.pop(role + '_id', None)
    return jsonify(ok=True)
