# Owner Web development API proxy

Run `npm.cmd run dev --workspace ./src/owner-web` from the repository root.
In development, authentication and business API clients all request `/api/...`
on the Owner Web origin. Vite forwards those requests to `VITE_API_BASE_URL`
from `src/owner-web/.env` (default `https://localhost:7240`).

For a localhost HTTPS API, Vite trusts the available workstation certificates
in `.tools/mobile-tls/localhost.cer` and `.tools/mobile-tls/root-ca.cer`.
Certificate and hostname verification remain enabled. The browser does not
connect directly to port 7240 and does not need to trust the API's private CA.
Reload the page after changing the API client configuration.

Production builds continue to require a configured HTTPS API URL.
The API process selects PostgreSQL/Neon through its backend environment file;
the Owner Web API URL does not select a database directly.
