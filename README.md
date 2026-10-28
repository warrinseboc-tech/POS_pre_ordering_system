# ISTILO ordering system

One Python/Flask application serves the customer, crew, and admin interfaces.
MySQL is the source of truth. Open the site through Python, not Live Server.

## Run on Windows

The virtual environment and local database have been initialized in this workspace.

    .\.venv\Scripts\python.exe backend\app.py

Open:
- Customer: http://127.0.0.1:5050/customer/
- Crew: http://127.0.0.1:5050/crew/
- Admin: http://127.0.0.1:5050/admin/

VS Code also has the "ISTILO - Python + MySQL" Run and Debug configuration.
Initial accounts are ADMIN001 and CREW001. Their generated passwords are stored
privately as ADMIN_PASSWORD and CREW_PASSWORD in backend/.env. The old demo
password crew123 is no longer accepted.

## Set up another machine

Requires Python 3.11+ and MySQL 8.0+. The tested environment uses Python 3.15.

    python -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

Copy backend/.env.example to backend/.env and enter MySQL credentials, then:

    .\.venv\Scripts\python.exe -m flask --app backend/app.py init-db
    .\.venv\Scripts\python.exe backend\app.py

init-db creates missing tables and products without replacing existing records.
The active database is istillo_db. Existing accounts and legacy products are retained.
For manual SQL import, run backend/database/schema.sql, then seed.sql in the
istillo_db database. Run init-db afterward to provision employee accounts.

To reset an employee password, use the hidden interactive prompt:

    .\.venv\Scripts\python.exe -m flask --app backend/app.py reset-password CREW001

## Payment and crew flow

1. Customer chooses products and GCash or Maya, creating an unpaid pickup request.
2. Customer transfers the exact amount and uploads a receipt image and reference.
3. Crew opens the order in Ordering and checks the actual receiving wallet's
   transaction history, amount, reference, recipient, sender, and time.
4. Crew approves the proof and confirms received funds. The receipt appears in the crew queue for verification; approval enables preparation.
5. Crew manually selects and punches the existing order, then marks ready/completed.

Rejecting proof blocks preparation and shows the customer a reason. A corrected image/reference may be resubmitted. A single reference cannot
pay for different orders. Payment images are private, validated, re-encoded,
and kept outside public frontend directories. Image validation cannot establish
that a transfer occurred; the receiving wallet must be checked.

GCash: Jayson Malinao / 09196281147
Maya: Warrin Seboc / 09196281147
Shop address: Canlubang, Calamba, Palao, Paikit, 4027.

These are manual wallet transfers. No merchant API credentials were supplied,
so this app does not automatically charge a wallet, confirm provider settlement,
or issue refunds. Details are configurable in backend/.env.

## Crew accounts and customer order editing

Admins create crew logins under Staff Management > Create crew account, using
an employee ID and an initial password of at least 12 characters. Accounts are
active immediately; admins can deactivate them from the same table.

Crew must clock in under My shift to receive online orders and payment receipts.
New orders appear in the Ordering live queue with a popup while clocked in.
Clocking out removes online order access, including server permission to edit,
verify payments, or advance orders. Other on-shift crew can continue the work.

Crew use Customer orders to edit items, quantities, sizes, and flavors before
preparation, or apply preparation/status actions. Every item edit requires a
reason. Orders with payments under review or verified must retain the same
total. Existing item prices are retained, and stale edits are rejected.
Customer confirmation screens update from the database after saved changes.

## Active structure

    backend/
      app.py                    Single Python entry point
      requirements.txt
      .env                      Private local credentials
      database/
        schema.sql              Tables, keys, constraints
        seed.sql                Initial menu
      istilo/
        __init__.py             App factory, static routes, security headers
        db.py                   MySQL transactions
        common.py               Validation and authorization
        auth.py                 Real staff authentication
        routes.py               Catalog, orders, staff, inquiries, expenses, shifts
        payments.py             Private proof upload and verification
        setup.py                Database initialization and password CLI
    customer/                   Customer interface and GCash/Maya payment UI
    crew/                       Combined walk-in and online ordering station
    admin/                      Management and payment verification
    shared/                     API store, shared controls, theme, images
    docs/API.md                 Routes and data/payment rules
    tests/                      Database and browser integration tests
    instance/                   Private uploads/session secret, ignored by Git
    archive/                    Retired apps and drafts; not served
    POS_pre_ordering_system/    Separate older repo, retained due to Windows locks

The old aron files are archived. Windows currently holds its empty original
directory open; close old terminals/editors to remove that empty directory.
The old separate POS repo remains intact because Windows prevented its move.
No older source or Git history was deleted.

## Verification

    .\.venv\Scripts\python.exe -m unittest discover -s tests -p test_backend.py -v
    node tests/portal-smoke.cjs

Browser checks require Node 22+ and Chrome. They start their own Python server
and disposable MySQL database, then remove that test database. They never insert
test sales into the live shop database. Screenshots are written to .tmp/.

For access from another device on a trusted LAN, set HOST=0.0.0.0 in backend/.env
and open the server machine's LAN address. Production deployment needs HTTPS,
a production WSGI server, secure cookies, backups, and appropriate database access.
Customers track their own guest orders through a private session cookie; guest
history does not follow them after clearing cookies or changing devices.
