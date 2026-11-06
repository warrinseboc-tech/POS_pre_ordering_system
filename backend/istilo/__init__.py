import hmac
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, abort, jsonify, redirect, request, send_from_directory, session
from mysql.connector import Error as DatabaseError, IntegrityError
from werkzeug.exceptions import HTTPException

from . import db

ROOT = Path(__file__).resolve().parents[2]


def create_app(overrides=None):
    load_dotenv(ROOT / 'backend' / '.env')
    instance = ROOT / 'instance'
    instance.mkdir(exist_ok=True)
    key_file = instance / 'session.key'
    if not key_file.exists():
        try:
            with key_file.open('x') as file:
                file.write(secrets.token_hex(32))
        except FileExistsError:
            pass
    app = Flask(__name__, static_folder=None, instance_path=str(instance))
    app.config.update(
        SECRET_KEY=os.getenv('SECRET_KEY') or key_file.read_text().strip(),
        DB_HOST=os.getenv('DB_HOST', '127.0.0.1'), DB_PORT=int(os.getenv('DB_PORT', '3306')),
        DB_USER=os.getenv('DB_USER', 'root'), DB_PASSWORD=os.getenv('DB_PASSWORD', ''),
        DB_NAME=os.getenv('PORTAL_DB_NAME', 'istillo_db'),
        UPLOAD_FOLDER=str(instance / 'payment-proofs'), MAX_CONTENT_LENGTH=6 * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_NAME='istilo_portal_session',
        SESSION_COOKIE_SECURE=os.getenv('COOKIE_SECURE', 'false').lower() == 'true',
        GCASH_NAME=os.getenv('GCASH_NAME', 'Jayson Malinao'), GCASH_NUMBER=os.getenv('GCASH_NUMBER', '09196281147'),
        MAYA_NAME=os.getenv('MAYA_NAME', 'Warrin Seboc'), MAYA_NUMBER=os.getenv('MAYA_NUMBER', '09196281147'),
        GCASH_QR_PATH=os.getenv('GCASH_QR_PATH', ''), MAYA_QR_PATH=os.getenv('MAYA_QR_PATH', ''),
    )
    if overrides:
        app.config.update(overrides)
    Path(app.config['UPLOAD_FOLDER']).mkdir(parents=True, exist_ok=True)
    app.teardown_appcontext(db.close_db)

    @app.before_request
    def protect_requests():
        if not request.path.startswith('/api/'):
            return
        session.setdefault('customer_token', secrets.token_hex(24))
        session.setdefault('csrf', secrets.token_hex(32))
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if not hmac.compare_digest(request.headers.get('X-CSRF-Token', ''), session['csrf']):
                abort(403, description='Security token expired. Refresh the page and try again.')

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.errorhandler(IntegrityError)
    def conflict(error):
        db.get_db().rollback()
        return jsonify(error='This reference, image, employee ID, or request already exists. Refresh before retrying.'), 409

    @app.errorhandler(DatabaseError)
    def database_error(error):
        app.logger.exception('Database request failed')
        return jsonify(error='Database unavailable. Check the database setup and try again.'), 503

    @app.errorhandler(500)
    def unexpected_error(error):
        return jsonify(error='The server could not complete this request. Please try again.'), 500

    @app.get('/')
    def index():
        return redirect('/customer/')

    @app.get('/<portal>/')
    @app.get('/<portal>/index.html')
    def portal_page(portal):
        if portal not in ('customer', 'crew', 'admin'):
            abort(404)
        return send_from_directory(ROOT / portal, 'index.html')

    @app.get('/<portal>/<path:filename>')
    def portal_asset(portal, filename):
        if portal not in ('customer', 'crew', 'admin', 'shared'):
            abort(404)
        if Path(filename).suffix.lower() not in ('.css', '.js', '.jpg', '.png', '.svg', '.woff2'):
            abort(404)
        return send_from_directory(ROOT / portal, filename)

    from .auth import auth
    from .routes import api
    from .payments import payments
    app.register_blueprint(auth, url_prefix='/api')
    app.register_blueprint(api, url_prefix='/api')
    app.register_blueprint(payments, url_prefix='/api')
    from .setup import register_commands
    register_commands(app)
    return app
