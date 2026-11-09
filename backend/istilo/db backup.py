import os
from contextlib import contextmanager

import mysql.connector
from flask import current_app, g


def connect(database=True):
    config = current_app.config
    params = dict(host=config['DB_HOST'], port=config['DB_PORT'], user=config['DB_USER'],
                  password=config['DB_PASSWORD'], charset='utf8mb4', autocommit=False)
    if database:
        params['database'] = config['DB_NAME']
    return mysql.connector.connect(**params)


def get_db():
    if 'database' not in g:
        g.database = connect()
    return g.database


def rows(sql, params=(), one=False):
    cursor = get_db().cursor(dictionary=True)
    try:
        cursor.execute(sql, params)
        return cursor.fetchone() if one else cursor.fetchall()
    finally:
        cursor.close()


def execute(sql, params=()):
    cursor = get_db().cursor()
    try:
        cursor.execute(sql, params)
        return cursor.rowcount
    finally:
        cursor.close()


@contextmanager
def transaction():
    db = get_db()
    # End any read-only snapshot before acquiring write locks.
    db.commit()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise


def close_db(_error=None):
    db = g.pop('database', None)
    if db:
        db.rollback()
        db.close()
