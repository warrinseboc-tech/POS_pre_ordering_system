import hmac
import hashlib
import json
import os
import secrets
import smtplib
from email.message import EmailMessage
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import Flask, abort, flash, jsonify, redirect, render_template, request, session, url_for
from mysql.connector import Error as MySQLError
from werkzeug.security import check_password_hash, generate_password_hash

from config import get_connection


app = Flask(
    __name__,
    template_folder="front",
    static_folder="front/static",
    static_url_path="/static",
)
app.config.update(
    SECRET_KEY=os.getenv("SECRET_KEY") or secrets.token_hex(32),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "false").lower() == "true",
    MAX_CONTENT_LENGTH=16 * 1024,
)


def csrf_token():
    token = session.get("csrf_token")
    if token is None:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


app.jinja_env.globals["csrf_token"] = csrf_token


def validate_csrf():
    submitted = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token", "")
    expected = session.get("csrf_token", "")
    if not expected or not hmac.compare_digest(submitted, expected):
        abort(400, description="Invalid form security token. Reload the page and try again.")


def login_required_api():
    if not session.get("user_id") or not session.get("user_email") or not session.get("email_verified"):
        return jsonify(error="Authentication required."), 401
    return None


def close_db(cursor=None, connection=None):
    if cursor is not None:
        cursor.close()
    if connection is not None:
        connection.close()


def otp_digest(email, code):
    secret = app.config["SECRET_KEY"].encode("utf-8")
    message = f"{email}:{code}".encode("utf-8")
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def send_resend_email(recipient, subject, text_body):
    api_key = os.getenv("RESEND_API_KEY")
    sender = os.getenv("RESEND_FROM_EMAIL")
    if not api_key or not sender:
        raise RuntimeError("Resend is not configured")

    resend_request = Request(
        "https://api.resend.com/emails",
        data=json.dumps({
            "from": sender,
            "to": [recipient],
            "subject": subject,
            "text": text_body,
        }).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(resend_request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def send_otp_email(recipient, subject, text_body):
    provider = os.getenv("OTP_EMAIL_PROVIDER", "resend").strip().lower()
    if provider == "resend":
        return send_resend_email(recipient, subject, text_body)
    if provider != "smtp":
        raise RuntimeError("OTP_EMAIL_PROVIDER must be 'resend' or 'smtp'")

    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "465"))
    username = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASSWORD", "")
    sender = os.getenv("SMTP_FROM_EMAIL", username)
    if not username or not password or not sender:
        raise RuntimeError("SMTP_USER, SMTP_PASSWORD, and SMTP_FROM_EMAIL are required")

    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(text_body)

    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=15) as smtp:
            smtp.login(username, password)
            refused = smtp.send_message(message)
            if refused:
                raise smtplib.SMTPRecipientsRefused(refused)
    else:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            smtp.login(username, password)
            refused = smtp.send_message(message)
            if refused:
                raise smtplib.SMTPRecipientsRefused(refused)
    return {"id": None}


def release_otp_cooldown(cursor, connection, email):
    """Permit retry when an email provider rejected delivery."""
    try:
        cursor.execute(
            "UPDATE pending_account_verifications "
            "SET last_sent_at = DATE_SUB(NOW(), INTERVAL 61 SECOND) WHERE user_email = %s",
            (email,),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        app.logger.exception("Could not release OTP resend cooldown")


@app.get("/")
def index():
    if session.get("user_id"):
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        validate_csrf()
        email = request.form.get("email", "").strip().lower()
        phone = request.form.get("phone", "").strip()
        password = request.form.get("password", "")

        if not email or not phone or len(password) < 8:
            flash("Enter an email, phone number, and a password with at least 8 characters.", "error")
            return render_template("auth/register.html"), 400

        connection = cursor = None
        try:
            connection = get_connection()
            cursor = connection.cursor(dictionary=True)
            cursor.execute(
                "SELECT user_id FROM accounts WHERE user_email = %s OR phone = %s LIMIT 1",
                (email, phone),
            )
            if cursor.fetchone():
                flash("An account with that email or phone already exists.", "error")
                return render_template("auth/register.html"), 409

            cursor.execute(
                "SELECT user_email, phone, last_sent_at, "
                "(last_sent_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)) AS cooling_down "
                "FROM pending_account_verifications WHERE user_email = %s OR phone = %s LIMIT 1",
                (email, phone),
            )
            pending = cursor.fetchone()
            if pending and (pending["user_email"] != email or pending["phone"] != phone):
                flash("That email or phone is already being used for another pending registration.", "error")
                return render_template("auth/register.html"), 409
            if pending and pending["cooling_down"]:
                session["pending_email"] = email
                flash("A code was requested recently. If it did not arrive, wait one minute and use RESEND CODE.", "error")
                return redirect(url_for("verify_email"))

            code = f"{secrets.randbelow(1_000_000):06d}"
            cursor.execute(
                "INSERT INTO pending_account_verifications "
                "(user_email, phone, password_hash, otp_hash, expires_at, attempts, last_sent_at) "
                "VALUES (%s, %s, %s, %s, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 0, NOW()) "
                "ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), "
                "otp_hash = VALUES(otp_hash), expires_at = VALUES(expires_at), "
                "attempts = 0, last_sent_at = NOW()",
                (email, phone, generate_password_hash(password), otp_digest(email, code)),
            )
            connection.commit()
            session["pending_email"] = email
            try:
                send_otp_email(
                    email,
                    "Verify your Istillo account",
                    f"Your Istillo verification code is {code}. It expires in 10 minutes.",
                )
            except smtplib.SMTPAuthenticationError:
                app.logger.exception("SMTP rejected the OTP email credentials")
                release_otp_cooldown(cursor, connection, email)
                flash("Your registration is saved, but SMTP authentication failed. Check your SMTP username and app password.", "error")
                return redirect(url_for("verify_email"))
            except smtplib.SMTPException:
                app.logger.exception("SMTP could not send the registration OTP")
                release_otp_cooldown(cursor, connection, email)
                flash("Your registration is saved, but SMTP could not send the OTP. Check the SMTP host and port.", "error")
                return redirect(url_for("verify_email"))
            except HTTPError as error:
                provider_message = error.read().decode("utf-8", errors="replace")
                app.logger.error(
                    "Resend rejected registration OTP (HTTP %s): %s",
                    error.code,
                    provider_message,
                )
                release_otp_cooldown(cursor, connection, email)
                if error.code == 401:
                    message = "Resend rejected the API key. Replace RESEND_API_KEY with an active key."
                elif error.code == 403:
                    message = "Resend rejected the sender. Verify your sending domain and update RESEND_FROM_EMAIL."
                else:
                    message = "Resend rejected the email. Check the Resend Logs and server output for details."
                flash(f"Your registration is saved, but the OTP email was not sent. {message}", "error")
                return redirect(url_for("verify_email"))
            except RuntimeError as error:
                app.logger.exception("OTP email provider is not configured")
                release_otp_cooldown(cursor, connection, email)
                flash(f"Your registration is saved, but email is not configured: {error}.", "error")
                return redirect(url_for("verify_email"))
            except (URLError, TimeoutError, json.JSONDecodeError, OSError):
                app.logger.exception("Resend could not send the registration OTP")
                release_otp_cooldown(cursor, connection, email)
                flash("Your registration is saved, but the email provider could not be reached. Check the server connection, then resend the code.", "error")
                return redirect(url_for("verify_email"))
            flash("Your email provider accepted the verification email. Check your inbox and Spam folder.", "success")
            return redirect(url_for("verify_email"))
        except MySQLError:
            if connection is not None:
                connection.rollback()
            app.logger.exception("Database error during account registration")
            flash("Database setup failed. Confirm the accounts table exists and run schema_otp.sql.", "error")
            return render_template("auth/register.html"), 503
        except Exception:
            if connection is not None:
                connection.rollback()
            app.logger.exception("Unexpected account registration error")
            flash("We could not finish your registration. Check the server log for the exact error.", "error")
            return render_template("auth/register.html"), 503
        finally:
            close_db(cursor, connection)

    return render_template("auth/register.html")


@app.route("/verify-email", methods=["GET", "POST"])
def verify_email():
    email = session.get("pending_email")
    if not email:
        return redirect(url_for("register"))

    if request.method == "POST":
        validate_csrf()
        code = request.form.get("otp", "").strip()
        if len(code) != 6 or not code.isdigit():
            flash("Enter the six-digit code from your email.", "error")
            return render_template("auth/verify.html"), 400

        connection = cursor = None
        try:
            connection = get_connection()
            connection.start_transaction()
            cursor = connection.cursor(dictionary=True)
            cursor.execute(
                "SELECT user_email, phone, password_hash, otp_hash "
                "FROM pending_account_verifications "
                "WHERE user_email = %s AND expires_at > NOW() AND attempts < 5 FOR UPDATE",
                (email,),
            )
            pending = cursor.fetchone()
            if not pending:
                connection.rollback()
                session.pop("pending_email", None)
                flash("That code expired or the attempt limit was reached. Please register again.", "error")
                return redirect(url_for("register"))

            if not hmac.compare_digest(pending["otp_hash"], otp_digest(email, code)):
                cursor.execute(
                    "UPDATE pending_account_verifications SET attempts = attempts + 1 WHERE user_email = %s",
                    (email,),
                )
                connection.commit()
                flash("That code is incorrect. You have up to five attempts.", "error")
                return render_template("auth/verify.html"), 400

            cursor.execute(
                "SELECT user_id FROM accounts WHERE user_email = %s LIMIT 1",
                (email,),
            )
            existing_account = cursor.fetchone()
            if existing_account:
                cursor.execute(
                    "UPDATE accounts SET email_verified = 1 WHERE user_id = %s",
                    (existing_account["user_id"],),
                )
            else:
                cursor.execute(
                    "INSERT INTO accounts (password, user_email, phone, email_verified) "
                    "VALUES (%s, %s, %s, 1)",
                    (pending["password_hash"], pending["user_email"], pending["phone"]),
                )
            cursor.execute(
                "DELETE FROM pending_account_verifications WHERE user_email = %s",
                (email,),
            )
            connection.commit()
            session.pop("pending_email", None)
            flash("Your email is verified and your account is ready. Please log in.", "success")
            return redirect(url_for("login"))
        except MySQLError:
            if connection is not None:
                connection.rollback()
            app.logger.exception("Database error during email verification")
            flash("Database setup failed. Run schema_email_verified.sql, then try the code again.", "error")
            return render_template("auth/verify.html"), 503
        except Exception:
            if connection is not None:
                connection.rollback()
            app.logger.exception("Email verification failed")
            flash("We could not verify your code right now. Please try again.", "error")
            return render_template("auth/verify.html"), 503
        finally:
            close_db(cursor, connection)

    return render_template("auth/verify.html")


@app.post("/resend-otp")
def resend_otp():
    validate_csrf()
    email = session.get("pending_email")
    if not email:
        return redirect(url_for("register"))

    connection = cursor = None
    try:
        connection = get_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT phone, (last_sent_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)) AS cooling_down "
            "FROM pending_account_verifications WHERE user_email = %s LIMIT 1",
            (email,),
        )
        pending = cursor.fetchone()
        if not pending:
            session.pop("pending_email", None)
            flash("Your pending registration expired. Please register again.", "error")
            return redirect(url_for("register"))
        if pending["cooling_down"]:
            flash("Please wait one minute before requesting another code.", "error")
            return redirect(url_for("verify_email"))

        code = f"{secrets.randbelow(1_000_000):06d}"
        cursor.execute(
            "UPDATE pending_account_verifications SET otp_hash = %s, "
            "expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE), attempts = 0, last_sent_at = NOW() "
            "WHERE user_email = %s",
            (otp_digest(email, code), email),
        )
        connection.commit()
        send_otp_email(
            email,
            "Your Istillo verification code",
            f"Your new Istillo verification code is {code}. It expires in 10 minutes.",
        )
        flash("Your email provider accepted the new verification email. Check your inbox and Spam folder.", "success")
    except Exception:
        if connection is not None:
            connection.rollback()
        app.logger.exception("Could not resend verification code")
        flash("We could not send a new code right now. Please try again later.", "error")
    finally:
        close_db(cursor, connection)
    return redirect(url_for("verify_email"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET" and session.get("user_id") and session.get("email_verified"):
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        validate_csrf()
        identifier = request.form.get("identifier", "").strip()
        password = request.form.get("password", "")
        if not identifier or not password:
            flash("Enter your email or phone and password.", "error")
            return render_template("auth/login.html"), 400

        connection = cursor = None
        try:
            connection = get_connection()
            cursor = connection.cursor(dictionary=True)
            cursor.execute(
                "SELECT user_id, password, user_email, phone, email_verified FROM accounts "
                "WHERE user_email = %s OR phone = %s LIMIT 1",
                (identifier.lower(), identifier),
            )
            account = cursor.fetchone()
            if not account:
                flash("The email/phone or password is incorrect.", "error")
                return render_template("auth/login.html"), 401

            stored_password = account["password"] or ""
            try:
                valid = check_password_hash(stored_password, password)
            except (ValueError, TypeError):
                valid = False

            # Upgrade legacy plaintext passwords after a successful login.
            if not valid and not stored_password.startswith(("scrypt:", "pbkdf2:")):
                valid = hmac.compare_digest(stored_password, password)
                if valid:
                    cursor.execute(
                        "UPDATE accounts SET password = %s WHERE user_id = %s",
                        (generate_password_hash(password), account["user_id"]),
                    )
                    connection.commit()

            if not valid:
                flash("The email/phone or password is incorrect.", "error")
                return render_template("auth/login.html"), 401

            if not account["email_verified"]:
                cursor.execute(
                    "SELECT (last_sent_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)) AS cooling_down "
                    "FROM pending_account_verifications WHERE user_email = %s LIMIT 1",
                    (account["user_email"],),
                )
                pending = cursor.fetchone()
                session["pending_email"] = account["user_email"]
                if pending and pending["cooling_down"]:
                    flash("Verify your email before logging in. The current code is still valid.", "error")
                    return redirect(url_for("verify_email"))

                code = f"{secrets.randbelow(1_000_000):06d}"
                cursor.execute(
                    "INSERT INTO pending_account_verifications "
                    "(user_email, phone, password_hash, otp_hash, expires_at, attempts, last_sent_at) "
                    "VALUES (%s, %s, %s, %s, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 0, NOW()) "
                    "ON DUPLICATE KEY UPDATE phone = VALUES(phone), password_hash = VALUES(password_hash), "
                    "otp_hash = VALUES(otp_hash), expires_at = VALUES(expires_at), "
                    "attempts = 0, last_sent_at = NOW()",
                    (
                        account["user_email"],
                        account["phone"],
                        stored_password,
                        otp_digest(account["user_email"], code),
                    ),
                )
                connection.commit()
                send_otp_email(
                    account["user_email"],
                    "Verify your Istillo account",
                    f"Your Istillo verification code is {code}. It expires in 10 minutes.",
                )
                flash("Verify your email before logging in. We sent you a verification code.", "success")
                return redirect(url_for("verify_email"))

            session.clear()
            session["user_id"] = account["user_id"]
            session["user_email"] = account["user_email"]
            session["phone"] = account["phone"]
            session["email_verified"] = True
            session["csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("dashboard"))
        except Exception:
            app.logger.exception("Login failed")
            flash("We could not sign you in right now. Check the database connection and try again.", "error")
            return render_template("auth/login.html"), 503
        finally:
            close_db(cursor, connection)

    return render_template("auth/login.html")


@app.get("/profile")
def profile():
    if not session.get("user_id") or not session.get("email_verified"):
        return redirect(url_for("login"))
    return render_template("cust-profile.html")


@app.get("/dashboard")
def dashboard():
    if not session.get("user_id") or not session.get("email_verified"):
        return redirect(url_for("login"))
    return render_template("cust-dashboard.html")


@app.get("/api/csrf-token")
def api_csrf_token():
    auth_error = login_required_api()
    if auth_error:
        return auth_error
    return jsonify(csrf_token=csrf_token())


@app.post("/api/emails")
def api_send_email():
    auth_error = login_required_api()
    if auth_error:
        return auth_error
    validate_csrf()

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Send a JSON object with subject and text."), 400

    subject = payload.get("subject")
    text_body = payload.get("text")
    if not isinstance(subject, str) or not isinstance(text_body, str):
        return jsonify(error="Both subject and text must be strings."), 400
    subject = subject.strip()
    text_body = text_body.strip()
    if (
        not subject
        or "\r" in subject
        or "\n" in subject
        or not text_body
        or len(subject) > 200
        or len(text_body) > 10000
    ):
        return jsonify(error="Subject must be 1-200 characters and text must be 1-10,000 characters."), 400

    api_key = os.getenv("RESEND_API_KEY")
    sender = os.getenv("RESEND_FROM_EMAIL")
    if not api_key or not sender:
        return jsonify(error="Email service is not configured."), 503

    resend_request = Request(
        "https://api.resend.com/emails",
        data=json.dumps({
            "from": sender,
            "to": [session["user_email"]],
            "subject": subject,
            "text": text_body,
        }).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(resend_request, timeout=10) as response:
            resend_result = json.loads(response.read().decode("utf-8"))
        return jsonify(id=resend_result.get("id")), 201
    except HTTPError as error:
        app.logger.warning("Resend rejected an email request with status %s", error.code)
        return jsonify(error="The email provider rejected the request."), 502
    except (URLError, TimeoutError, json.JSONDecodeError):
        app.logger.exception("Could not reach Resend")
        return jsonify(error="The email provider is temporarily unavailable."), 502


@app.post("/logout")
def logout():
    validate_csrf()
    session.clear()
    flash("You have been logged out.", "success")
    return redirect(url_for("login"))


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
