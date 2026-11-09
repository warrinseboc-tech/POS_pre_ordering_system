"""ISTILO database access: PostgreSQL on Render, optional local MySQL fallback."""
import os
from contextlib import contextmanager
from flask import current_app, g
import mysql.connector
import psycopg2
from psycopg2.extras import RealDictCursor

def is_postgres():
    return bool(current_app.config.get('DATABASE_URL'))

def connect(database=True):
    if is_postgres():
        url = current_app.config['DATABASE_URL']
        if url.startswith('postgres://'):
            url = 'postgresql://' + url[len('postgres://'):]
        return psycopg2.connect(url, sslmode='require')
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
    db = get_db()
    cursor = db.cursor(cursor_factory=RealDictCursor) if is_postgres() else db.cursor(dictionary=True)
    try:
        cursor.execute(sql, params)
        result = cursor.fetchone() if one else cursor.fetchall()
        return dict(result) if one and result is not None else ([dict(r) for r in result] if not one else None)
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
