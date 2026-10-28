# Crew portal
Run the Python backend and open http://127.0.0.1:5050/crew/.
Sign in using a real staff account; the initial CREW001 password is in backend/.env.
Ordering combines incoming online orders, products, current order, and cash payment.
Only payment-verified online orders reach the queue. Select and punch them manually.
Walk-in cash orders complete at the counter; pay-later counter orders remain active.
Database polling updates orders across devices connected to the same Python server.
Inquiries, shifts, profile edits, menu availability, and history are also database-backed.
See ../README.md and ../docs/API.md.