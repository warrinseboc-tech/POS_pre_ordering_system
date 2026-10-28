# SQL files

- `schema.sql` and `seed.sql`: the active `istillo_db` portal setup.
- `istillo_db.sql`: complete MySQL Workbench script for the `istillo_db` name
  used in the older project, with account-verification and inventory tables.

For the older database, back it up, then open and execute the **entire**
`istillo_db.sql` file in Workbench. It uses `CREATE DATABASE`, rather than
`CREATE TABLE`, to create/select the database. It does not delete account 10.
An incompatible old products table is retained as `products_legacy`. Its old
`quantiity` values remain there; the new product catalog stores order quantities
in `order_items.quantity`. Legacy products need their categories, flavors, and
sizes reviewed before importing. The retained inventory table is not connected
to automatic stock deduction.

To run the Python app against this database, set this in `backend/.env`:

```dotenv
PORTAL_DB_NAME=istillo_db
```

Then provision the staff accounts and restart Python:

```powershell
.\.venv\Scripts\python.exe -m flask --app backend/app.py init-db
.\.venv\Scripts\python.exe backend/app.py
```

Switching the database selects a different set of orders and staff records; it
does not copy existing `istillo_portal` orders into `istillo_db`. The running app's
configuration is now set to `istillo_db`. The former database is retained.
