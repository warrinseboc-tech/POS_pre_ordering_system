import os
import re
import secrets
from pathlib import Path

import click
from dotenv import dotenv_values, set_key
from werkzeug.security import generate_password_hash

from .common import uid
from .db import connect, execute, rows, transaction


def initialize(app, seed=True):
    name=app.config['DB_NAME']
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}',name): raise ValueError('Invalid database name')
    connection=connect(database=False)
    cursor=connection.cursor()
    try:
        source=(Path(__file__).parents[1]/'database'/'schema.sql').read_text(encoding='utf-8').replace('istillo_db',name)
        for statement in source.split(';'):
            if statement.strip(): cursor.execute(statement)
        # Upgrade an earlier local setup while keeping reference ownership and audit history.
        cursor.execute('INSERT IGNORE INTO payment_references(wallet,reference_number,order_id) SELECT wallet,reference_number,order_id FROM payment_proofs')
        cursor.execute("SHOW INDEX FROM payment_proofs WHERE Key_name='wallet_reference'")
        if cursor.fetchall():
            cursor.execute('ALTER TABLE payment_proofs DROP INDEX wallet_reference')
        if seed:
            source=(Path(__file__).parents[1]/'database'/'seed.sql').read_text(encoding='utf-8')
            for statement in source.split(';'):
                if statement.strip(): cursor.execute(statement)
        connection.commit()
    finally:
        cursor.close(); connection.close()


def register_commands(app):
    @app.cli.command('init-db')
    def init_db():
        """Create missing tables and menu items without deleting existing records."""
        initialize(app)
        env_path=Path(__file__).parents[1]/'.env'
        env=dotenv_values(env_path)
        with transaction():
            for role,employee,name,prefix in [('admin','ADMIN001','Administrator','ADMIN'),('crew','CREW001','Crew member','CREW')]:
                if rows('SELECT id FROM users WHERE employee_id=%s',(employee,),one=True): continue
                password=env.get(prefix+'_PASSWORD') or secrets.token_urlsafe(20)
                if not env.get(prefix+'_PASSWORD'): set_key(str(env_path),prefix+'_PASSWORD',password)
                execute('INSERT INTO users(id,employee_id,name,email,password_hash,role) VALUES(%s,%s,%s,%s,%s,%s)',(uid('USR'),employee,name,'',generate_password_hash(password),role))
        click.echo('Database initialized. ADMIN001 and CREW001 passwords are in backend/.env; existing accounts were preserved.')

    @app.cli.command('reset-password')
    @click.argument('employee_id')
    @click.password_option(confirmation_prompt=True)
    def reset_password(employee_id,password):
        if len(password)<12: raise click.ClickException('Use at least 12 characters.')
        with transaction():
            if not execute('UPDATE users SET password_hash=%s WHERE employee_id=%s',(generate_password_hash(password),employee_id.upper())):
                raise click.ClickException('Employee not found.')
        click.echo('Password updated.')
