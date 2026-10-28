# Python routes

Flask serves every portal from one origin. The `X-Portal` header selects the
customer, crew, or admin session. Crew and admin sessions can coexist in separate
tabs. Only crew with an active shift receive online orders/proofs or handle
online payment, item, punch, and status changes. Admins retain read access to
orders. `GET /api/state` includes `onShift`. Every write also requires `X-CSRF-Token` from `GET /api/state`.

| Method | Route | Access / purpose |
| --- | --- | --- |
| GET | `/customer/`, `/crew/`, `/admin/` | Portal HTML |
| GET | `/api/state` | Public catalog/business; only the caller's authorized data |
| GET | `/api/health` | Confirms MySQL connectivity and actual selected database |
| POST | `/api/auth/login` | Employee ID, password, and role |
| POST | `/api/auth/logout` | Sign out selected employee portal |
| POST | `/api/orders` | Customer GCash/Maya order or authorized counter order |
| POST | `/api/orders/<id>/proof` | Owner uploads multipart `proof`, `reference`, `amount` |
| GET | `/api/payments/proofs/<id>/image` | Order owner or active crew only |
| POST | `/api/payments/proofs/<id>/review` | Crew only: approve/reject; approval requires confirmed amount/reference |
| PATCH | `/api/orders/<id>/items` | Crew edits pending customer items with a reason and expectedUpdatedAt; protected payment totals stay fixed |
| POST | `/api/orders/<id>/punch` | Crew/admin manually accepts a released, paid order |
| POST | `/api/orders/<id>/status` | Authorized forward preparation/status transition |
| POST | `/api/orders/<id>/cash` | Crew/admin collects an unpaid counter order |
| POST | `/api/products` | Admin adds or edits a product |
| PATCH | `/api/products/<id>/availability` | Crew/admin availability |
| POST | `/api/inquiries` | Customer sends a shop inquiry |
| PATCH | `/api/inquiries/<id>` | Staff follow-up note/status |
| POST | `/api/staff` | Admin creates crew account with hashed password |
| PATCH | `/api/staff/<id>` | Admin activation/deactivation |
| PATCH | `/api/profile` | Employee display name and email |
| POST | `/api/shifts/in`, `/api/shifts/out` | Employee shift records |
| POST | `/api/expenses` | Admin adds or edits expense |
| DELETE | `/api/expenses/<id>` | Admin deletes expense |

## Database

MySQL 8.0 database `istillo_db` contains users, products, orders, immutable
order_items, payment_references, payment_proofs, order_events, inquiries,
expenses, shifts, and login_attempts. Prices are integer centavos. The server
validates options and prices against the catalog; it never trusts a submitted
cart total. Order mutations use transactions and row locks. Request keys prevent
duplicate order creation during retries.

`backend/database/schema.sql` creates the schema and
`backend/database/seed.sql` inserts missing menu products without replacing edits.
`init-db` also handles the earlier local reference-index upgrade without deleting
existing records. The previous account database is not modified.

## Payment release rule

1. Customer creates a GCash or Maya order: **Awaiting proof**. Crew cannot see it.
2. Customer transfers the exact amount and uploads a receipt: **Under review**.
3. Admin compares the receipt with the actual receiving wallet transaction
   history, enters its reference and received amount, and confirms receipt.
4. Approval sets **Verified** and `released_at`, releasing the same order ID to crew.
5. Crew manually punches, prepares, marks ready, and completes the paid order.

Rejected proofs keep the order hidden. The customer sees a reason and may upload
corrected evidence, including the same reference for that same order. A reference
cannot be used by another order. Images are decoded/validated with Pillow,
re-encoded without metadata, and stored outside public assets. Image validation
checks file integrity; it cannot determine whether a wallet transfer occurred.

This is a **manual wallet-transfer integration**, not a payment-provider checkout
or automatic settlement API. No merchant API credentials were supplied. The site
does not automatically charge wallets or perform refunds. An automatic provider
integration would additionally require that provider's merchant account, API
credentials, signed callbacks, and public HTTPS configuration.

Anonymous customers see their own orders through a signed, HTTP-only session
cookie. Separate devices share the database, while customer order ownership stays
with the browser session that placed it. Clearing cookies loses guest tracking;
account-based cross-device customer history is not implemented.
