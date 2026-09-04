# QA Context — MOW

## Environments
- Staging URL: env var `MOW_STAGING_QA_URL`.
- QA login: username in `MOW_STAGING_QA_USERNAME`, password in `MOW_STAGING_QA_PASSWORD`.
- Confluence/wiki pages (e.g. style guide, component docs) are accessible with the same staging login/SSO as the app — no separate credentials needed.

## Test Data
- The QA staging login is fully provisioned with data/permissions to view all ERP data table pages, including client entitlements, dex report, daily meal runs, and audit logs.

## Known Gotchas
- None noted yet.

## Context Log
- 2026-09-04: initial context created (from MOW-1272 run)
- 2026-09-04: confirmed Confluence wiki uses same staging login/SSO, and QA staging account has full data/permission access to all ERP data table pages (resolved from MOW-1272 run)
