import functools
import secrets
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from flask import abort, g, request, session

from .db import rows


def uid(prefix):
    return prefix + '-' + secrets.token_hex(16)


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(value):
    return value.replace(tzinfo=timezone.utc).isoformat() if value else None


def text(value, length, required=False):
    if not isinstance(value, str):
        abort(400, description='Text field has an invalid value.')
    value = value.strip()
    if len(value) > length or (required and not value):
        abort(400, description=f'Text is required and must fit within {length} characters.')
    return value


def cents(value, positive=False):
    if isinstance(value, bool):
        abort(400, description='Invalid monetary amount.')
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 or amount > 1000000 or amount.as_tuple().exponent < -2:
            raise ValueError()
        if positive and amount <= 0:
            raise ValueError()
        return int(amount * 100)
    except (InvalidOperation, ValueError, TypeError):
        abort(400, description='Enter a valid amount with at most two decimal places.')


def payload():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        abort(400, description='A JSON object is required.')
    return data


def actor():
    if not hasattr(g, 'actor'):
        portal = request.headers.get('X-Portal')
        user_id = session.get(portal + '_id', '') if portal in ('admin', 'crew') else ''
        g.actor = rows('SELECT * FROM users WHERE id=%s AND active=1 AND role=%s', (user_id, portal or ''), one=True)
    return g.actor


def require(*roles):
    def decorator(func):
        @functools.wraps(func)
        def wrapped(*args, **kwargs):
            user = actor()
            if not user:
                abort(401, description='Sign in to continue.')
            if user['role'] not in roles:
                abort(403, description='You do not have access to this action.')
            return func(*args, **kwargs)
        return wrapped
    return decorator


def active_shift(user, lock=False):
    if not user or user['role']!='crew': return None
    if lock:
        rows('SELECT id FROM users WHERE id=%s FOR UPDATE',(user['id'],),one=True)
    return rows('SELECT id FROM shifts WHERE employee_id=%s AND end_at IS NULL',(user['id'],),one=True)


def require_online_shift(order):
    if order and order['source']=='Customer':
        if not active_shift(actor(),lock=True):
            abort(403,description='Only crew on an active shift can handle online orders. Clock in under My shift.')


def own_order(order):
    user = actor()
    if not order:
        abort(404, description='Order not found.')
    if user and user['role'] == 'admin':
        return
    if user and user['role'] == 'crew' and (order['source'] == 'Counter' or order['payment_status'] == 'Verified' and order['released_at']):
        return
    if order['customer_token'] != session.get('customer_token'):
        abort(404, description='Order not found.')


def event(order_id, kind, detail='', actor_id=None):
    from .db import execute
    execute('INSERT INTO order_events(order_id,actor_id,event_type,detail) VALUES(%s,%s,%s,%s)',
            (order_id, actor_id, kind, detail))
