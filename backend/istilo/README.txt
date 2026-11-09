ISTILO Render + Supabase PostgreSQL adaptation (not tested against live Supabase)

Replace files in backend/istilo/ with matching filenames. Back up originals first.
Add psycopg2-binary to backend/requirements.txt. Keep mysql-connector-python if you still run local MySQL.
Set DATABASE_URL and SECRET_KEY in Render environment. Do not put secrets in GitHub.
The setup.py MySQL migration commands are blocked in PostgreSQL mode. Import schema through Supabase SQL Editor instead.
Other files or schema differences may require further fixes. Test /api/health, /api/state, login, OTP, product changes, orders, payments.
WARNING: Render's ephemeral disk does not persist product images/payment receipts. Use persistent object storage before relying on uploads in production.
