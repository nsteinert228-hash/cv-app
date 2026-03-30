# Garmin Connect Integration Limitations

## No Public OAuth2 API

Garmin does not provide a public OAuth2 API for consumer health data. The official
Garmin Health API is only available to registered business partners with an approved
application.

## How Authentication Works

This integration uses the `garmy` library (a modern Garmin Connect client with
OAuth token management) to authenticate:

1. **Initial connect**: The user provides their Garmin email and password via the
   frontend. The password is encrypted at rest using `pgp_sym_encrypt` (pgcrypto)
   and stored in the `garmin_connections` table.

2. **Token exchange**: On the first sync, the Python service decrypts the password,
   authenticates with Garmin Connect via `garmy`, and obtains OAuth tokens. These
   tokens are cached to disk (`GARMIN_TOKEN_DIR`) for subsequent syncs.

3. **Token refresh**: `garmy` automatically refreshes expired OAuth2 tokens using
   the stored refresh token. If the refresh token itself expires, the service
   falls back to re-authenticating with the stored (encrypted) password.

## Security Considerations

- Passwords are encrypted with AES-256 via PostgreSQL's `pgp_sym_encrypt`
- The encryption key (`GARMIN_ENCRYPTION_KEY`) is stored as a server-side environment
  variable, never exposed to the frontend
- Passwords are only decrypted by the Python sync service (service_role access)
- Frontend users cannot read the `encrypted_tokens` column (RLS prevents it)

## Sync Architecture

The Python sync service must run as a **cron job** (e.g., every 15 minutes via
`python main.py sync-all`). It cannot be triggered in real-time by Supabase Edge
Functions because:

- `garmy` is a Python-only library
- Supabase Edge Functions run Deno (TypeScript), not Python
- The edge functions only set `status = 'sync_requested'` in the database
- The Python cron picks up requested syncs and performs the actual data fetch

## Known Limitations

- **No real-time sync**: Data updates depend on the cron interval
- **Rate limiting**: Garmin aggressively rate-limits API calls; the sync service
  includes 1-second delays between requests
- **Account lockout risk**: Too many failed login attempts can temporarily lock a
  Garmin account
- **Unofficial API**: Garmin could change their internal API at any time, breaking
  the `garmy` library
