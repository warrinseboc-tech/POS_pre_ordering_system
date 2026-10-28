# Customer portal
Run the Python backend and open http://127.0.0.1:5050/customer/.
Menu, About, and Contact are dynamic. The catalog and ordering data come from MySQL.
Online pickup orders require GCash or Maya transfer, receipt image, reference,
and admin confirmation before crew can receive or prepare them.
The address and supplied wallet recipients are configured in the Python backend.
Private session cookies limit guest order/proof visibility to the ordering browser.
See ../README.md and ../docs/API.md. Do not use Live Server for the API-backed portals.