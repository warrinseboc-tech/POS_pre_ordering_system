# Customer registration email verification

## Password verification extension

Customer profile password changes and forgotten-password resets now also require
an email OTP. The existing reset-password endpoint initiates verification instead
of changing the password immediately. The proposed password is hashed in MySQL;
the password is committed only by reset-password/verify with the correct code and
session token. Registration codes cannot authorize password changes.

The additive `backend/database/password_otp.sql` migration creates a separate
password_change_verifications table keyed by email, compatible with legacy account
ID types. It has been applied locally, and the local server restarted. On another
installation run:

```powershell
.venv/Scripts/python.exe -m flask --app backend/app.py upgrade-password-otp
```

Codes expire in five minutes, allow five incorrect attempts, and can be resent
after 60 seconds. Request and verification rate limits use separate password
buckets. Successful verification deletes the code and signs out the current
customer session before returning to login. Failed email delivery leaves the
existing password unchanged. Admin/crew password behavior is unchanged.

The OTP integration suite now has eleven passing tests. The Chrome test also
passes profile password update and forgotten-password verification followed by
login with the new password. Mail is captured in tests; no test emails are sent.
This extension modifies auth.py, email_otp.py, setup.py, schema.sql, shared/store.js,
customer/app.js, customer/index.html, both OTP test files, and this guide. The
password_otp.sql migration is new. These changes supersede the earlier
registration-only scope following the user's explicit password OTP request.

Registration now creates an `accounts` row with `email_verified=0`. The existing
login route already rejects unverified accounts. Verification activates the account
and returns to the existing login form without automatically signing in.
Admin/crew authentication and password hashing remain unchanged.

## Database setup

Inspected the configured live MySQL database before implementation: customers use
`accounts.user_id INT`, while staff use `users.id VARCHAR(64)`. The live database
already has `accounts.email_verified` and `pending_account_verifications`. No
customer records or live schema were changed during initial implementation/testing.
During the subsequent resend repair, the additive OTP migration was applied to the
configured live database and the local Flask server was restarted. Existing customer
records were preserved. Gmail TLS connectivity and sender authentication were verified
without sending a test email. The local configuration uses port 465 with SMTP_SSL=true.

The additive, rerunnable migration is `backend/database/email_otp.sql`. It reuses
the pending table, adds a hashed registration token column, and adds an email
unique index where missing. No foreign key with an incompatible ID type is added:
the existing pending table is keyed by email. Its legacy password_hash field is
left empty for new rows; account passwords stay in the existing accounts column.

Run from the repository root before restarting the application:

```powershell
.venv/Scripts/python.exe -m flask --app backend/app.py upgrade-email-otp
```

Alternatively, select your existing portal database in MySQL Workbench and run
`backend/database/email_otp.sql`. The SQL uses `DATABASE()` and does not create or
select a replacement database. Existing verification flags are preserved. If the
column is missing, preexisting accounts remain eligible to log in; new accounts
default to unverified. Duplicate existing emails cause the unique index addition
to fail without deleting records; resolve duplicates manually and rerun. MySQL DDL
implicitly commits, so earlier additive steps can remain applied after an error.

Fresh installations also get the pending table from `schema.sql`. Existing
installations must run the upgrade command, even if they previously ran init-db.

## Local email configuration

For a deployed server, configure SMTP in that hosting service's environment settings.
The private local `backend/.env` is ignored by Git and is not included in a deployment.
Keep `DATABASE_URL` set to the existing Supabase connection URL; SMTP settings are independent.
Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, and
`SMTP_SSL` on the server, then restart or redeploy. `SMTP_USER` and `SMTP_FROM_EMAIL`
are accepted aliases for the username and sender. Port 465 uses `SMTP_SSL=true`;
port 587 uses `SMTP_SSL=false` (STARTTLS).

Add these values to the existing `backend/.env` (do not commit this file):

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-address@gmail.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM=your-address@gmail.com
SMTP_SSL=false
```

Enable Google account 2-Step Verification and create an App Password for this
application: https://support.google.com/accounts/answer/185833.
Use that App Password, rather than your ordinary Google password. Gmail SMTP
uses smtp.gmail.com with STARTTLS on port 587:
https://support.google.com/mail/answer/7104828.
An organization may restrict App Password availability; another SMTP provider can
use the same variables. For implicit TLS, set SMTP_SSL=true and SMTP_PORT=465.
Restart the existing Flask server after setting these variables and migrating.

No new Python dependencies are required. Email uses Python's smtplib, ssl, and
email modules. A real inbox delivery check still requires your SMTP credentials.
Tests capture SMTP and do not send messages to external addresses.

## Verification controls

- Secure random six-digit codes, valid for five minutes.
- HMAC-SHA256 code hashes keyed by the existing persistent application secret.
- Five incorrect attempts per code; counters commit even when verification fails.
- Resends wait 60 seconds, invalidate the previous code, and reset its attempts.
- Persistent per-IP limits: ten registration/resend requests and thirty verification
  requests per fifteen minutes. These use the existing login_attempts table with
  separate buckets from staff sign-in.
- A random session token is associated with the pending row by its stored HMAC.
  Verification/resend cannot choose another customer's email or account ID.
- Verification removes the pending row; replay is rejected.
- SMTP failures roll back signup, or preserve the previous code on failed resend.
- Existing CSRF validation, cookie protections, transactions and parameterized SQL
  remain in use. Email uniqueness plus transactional phone locks prevent duplicate
  concurrent registrations without changing legacy phone fields.

The OTP screen uses the existing modal and CSS classes. It includes loading and
error states, resend countdown, a back button, and a success message on the login
form. Reopening registration in the same browser resumes pending verification,
including after refresh. Losing the browser's session cookie also loses access to
that pending verification; cross-browser account recovery is outside this feature.

## Validation

```powershell
.venv/Scripts/python.exe -m unittest discover -s tests -p test_email_otp.py -v
.venv/Scripts/python.exe -m unittest discover -s tests -p test_email_otp_browser.py -v
.venv/Scripts/python.exe -m unittest discover -s tests -p test_backend.py -v
```

All database tests use uniquely named disposable databases, never the live tables.
OTP tests cover success, invalid codes, expiry, attempt limits, resend cooldown,
old-code invalidation, duplicate email/phone, terms validation, per-IP rate limits,
SMTP failure rollback, token ownership, replay rejection, unverified login rejection,
SMTP TLS/content, pending session restoration and rerunnable migration.
The Chrome test covers the actual signup form, countdown, incorrect-code feedback,
verification success, return to login, and successful customer login. Set CHROME_PATH
if Chrome is installed outside the test's default Windows location.

The backend regression fixtures were updated to authenticate a verified customer,
accept order policies, and use current Ice options and numeric payment references.
Seven of eight backend scenarios pass, including ordering, proof review, cash POS,
staff creation and crew order editing. The preexisting shift test fails because
`routes.py` reports onShift=true for any authenticated crew after clock-out; its
teardown also fails when attempting a second clock-out. This production behavior
was not modified by the registration feature. Expenses/analytics were not changed
and have not received separate end-to-end checks in this task.

## Files for this feature

Modified:
- backend/.env.example
- backend/database/schema.sql
- backend/istilo/__init__.py
- backend/istilo/auth.py
- backend/istilo/setup.py
- customer/app.js
- customer/index.html
- shared/store.js
- tests/test_backend.py

Added:
- backend/database/email_otp.sql
- backend/istilo/email_otp.py
- tests/test_email_otp.py
- tests/test_email_otp_browser.py
- docs/EMAIL_OTP.md

The earlier admin/index.html logout fix and preexisting POS submodule changes are
separate from this feature.
