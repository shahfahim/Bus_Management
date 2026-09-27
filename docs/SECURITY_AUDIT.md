# UniRide security and reliability audit

## Re-audit — 2026-09-27

Scope: everything added since the first audit (boarding cards and door readers, trip schedules, student
verification documents, the teacher role, student credits), a re-check of the baseline, dependencies,
the live deployment's headers, and read-only queries against the production database's configuration.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| SEC-09 | High | Supabase's Data API roles (`anon`, `authenticated`) had full privileges on all 43 tables and no table had row-level security, so the users table (password hashes), sessions and credit balances were reachable outside the API by anyone holding the project's publishable key. | Migration `20260928000000_lock_down_supabase_data_api` enables RLS on every table and revokes those roles' privileges, including default privileges for future tables. The API's role bypasses RLS, so behaviour is unchanged. Verified on a Supabase-like database: before, `anon` could read `users`; after, permission denied, and new tables are also denied. |
| SEC-10 | High | Vulnerable production dependencies: `multer` (upload denial of service, file-size limit bypass) and `qs` (denial of service). | Updated to `multer` 2.4.0 and `qs` 6.16.0 (`npm audit --omit=dev`: 0 vulnerabilities). |
| SEC-11 | Medium | Behind Render's Cloudflare edge, `request.ip` was always an internal proxy address, so per-address rate limits (sign-in, uploads, global limiter) were shared by all visitors — an attacker could trip them for everyone — and sessions and audit logs recorded no real address. | `CLIENT_IP_HEADER=cf-connecting-ip` (set in `render.yaml`) makes the API use Cloudflare's visitor address; a missing or malformed header falls back to the previous behaviour. |
| SEC-12 | Medium | Door reader API keys (`X-Door-Reader-Key`) were written to request logs in plain text. | Header added to log redaction; regression test covers bearer, cookie and reader-key headers. |
| SEC-13 | Medium | Admin CSV exports allowed spreadsheet formula injection through user-controlled text (names, titles, notes). | Exports escape cells starting with `=`, `+`, `-`, `@`. |
| SEC-14 | Low | Successful self-registrations were unlimited, each able to store an identity document. | 10 registrations per hour per network, applied before the upload is read. |
| SEC-15 | Low | The door-reader limit was keyed by the supplied key, so rotating made-up keys bypassed it. | Rejected keys are also limited per address (20 per 15 minutes); genuine readers' refused scans do not count. Regression test added. |
| SEC-16 | Low | Public lost-and-found responses included administrators' internal verification notes and reviewer identity. | Only the reporter and administrators receive them. Regression test added. |
| SEC-17 | Low | Unique-constraint conflicts returned database constraint and column names. | The details are logged, not returned. |

Reviewed without a confirmed issue: JWT algorithm/issuer/audience pinning, HttpOnly SameSite cookies,
refresh-token rotation with reuse detection, bcrypt with a dummy hash against user enumeration by
timing, temporary-password enforcement, registration locked to the student role, last-administrator
protection, admin-only verification documents with magic-byte checks, driver/conductor scoping of manual
check-ins, 80-bit boarding codes and 192-bit hashed reader keys, credit ledger integrity (non-negative
balance, single-use receipts, idempotent payments), profile updates limited to name/phone/department,
Socket.IO origin and session checks, live security headers (HSTS, strict CSP, nosniff, frame and
resource policies) and hostile-origin rejection (403).

Remaining: `vitest` (development only) has a moderate advisory whose fix is a major upgrade; do it as
separate work. Registration still reveals whether an email is already registered, an accepted
usability trade-off now bounded by the registration limit.


Audit date: 2026-08-25
Scope: repository source, dependency/configuration state, local automated checks, and non-destructive public checks against `https://uniride-shahfahim.onrender.com`.

## Executive summary

The application has a sound baseline: Prisma parameterization, database constraints for booking/seat/QR races, short-lived signed access tokens, rotating hashed refresh tokens, server-side session revocation, role checks, private object storage, upload content checks, an overdraft-proof credit ledger, exact-origin CORS, secure production cookies, and strong security headers.

The audit confirmed eight security or abuse-control issues. All eight have targeted code fixes and regression checks. No critical vulnerability, SQL injection, command injection, path traversal, unrestricted file upload, unauthenticated admin access, or known vulnerable npm dependency was confirmed.

The most important remaining risk is verification depth: API line coverage is 27.61%, with the largest gaps in booking, payment, tracking, QR service, and admin service integration paths. Those areas received static review, but they still need database-backed integration and browser end-to-end suites before a high-assurance production claim is appropriate.

## Finding totals

| Severity | Confirmed findings | Open engineering risks |
| --- | ---: | ---: |
| Critical | 0 | 0 |
| High | 1 | 0 |
| Medium | 4 | 1 |
| Low | 3 | 0 |
| Informational | 0 | 2 |

## Confirmed findings and remediation

### SEC-01 — Browser-readable session credentials

- Severity: High
- Affected: `POST /api/auth/login`, `POST /api/auth/refresh`, auth routes, web API client, Socket.IO client
- Evidence: auth routes returned service results containing access and refresh tokens; the web client persisted the access token in `sessionStorage` and sent it as a bearer credential.
- Impact: an XSS or compromised browser extension could extract a long-lived refresh token from a response and an access token from JavaScript storage.
- Fix: return only safe user/expiry data, keep both credentials in HttpOnly cookies, clear legacy browser storage immediately, and authenticate same-origin Socket.IO with cookies.
- Verification: route regressions assert that login/refresh JSON contains no credentials; client tests assert no Authorization header or stored token.

### SEC-02 — Self-registration falsely verified arbitrary identities

- Severity: Medium
- Affected: `POST /api/auth/register`, registration UI, admin user activation
- Evidence: registration accepted any syntactically valid email, set `ACTIVE`, populated `emailVerifiedAt`, and immediately created a session without verifying mailbox or university identity.
- Impact: an attacker could reserve or impersonate a student identity before the legitimate student registered.
- Fix: accept any valid email as required by the product, but create every self-registered student, teacher, or driver as `PENDING_VERIFICATION` without a session. Return HTTP 202, show an approval notice, and set verification time only when an administrator activates the account.
- Verification: tests cover external email providers and assert pending status, null verification time, correct role-specific profile creation, and no issued session.

### SEC-03 — Targeted account lockout denial

- Severity: Medium
- Affected: `POST /api/auth/login`, authentication service
- Evidence: five wrong passwords set a global 15-minute `lockedUntil`, so anyone knowing an address could deny that user login.
- Impact: targeted availability denial against students, drivers, or administrators.
- Fix: remove attacker-controlled global timed locks and apply a five-attempt, 15-minute limiter keyed by normalized IP plus hashed account identifier, while retaining failure telemetry and the broader per-IP limiter.
- Verification: regression test confirms five failures are processed and the sixth is throttled; service tests confirm failures no longer set `lockedUntil`.

### SEC-04 — Public operational records exposed internal fields

- Severity: Medium
- Affected: public maintenance and road-alert list/detail endpoints
- Evidence: DTOs spread full Prisma records, including maintenance cost, internal notes, creator identifier, and administrator identity.
- Impact: disclosure of internal financial/operations data and staff metadata.
- Fix: dedicated public DTOs expose only rider-relevant state; public detail reads are restricted to currently relevant maintenance; admin endpoints retain full records.
- Verification: DTO regressions assert that cost, notes, creator, and creator ID are absent.

### SEC-05 — Cross-account push subscription reassignment

- Severity: Medium
- Affected: `POST /api/notifications/push/subscriptions`
- Evidence: upsert-by-endpoint updated `userId`, allowing an authenticated user who knew another endpoint to move it to their account.
- Impact: notification denial or misdelivery.
- Fix: an endpoint owned by another user now returns 409 and ownership is never changed during update.
- Verification: route regression asserts 409 and confirms no upsert occurs.

### SEC-06 — Notification click could navigate off-site

- Severity: Low
- Affected: `apps/web/public/sw.js`
- Evidence: an absolute `actionUrl` was converted to a URL and opened without checking its origin.
- Impact: a malicious or corrupted push payload could turn a trusted notification into an external redirect.
- Fix: allow only same-origin targets and fall back to `/notifications`.
- Verification: source review plus production web build.

### SEC-07 — Over-broad browser connection/resource policy

- Severity: Low
- Affected: Helmet configuration
- Evidence: CSP allowed all HTTPS/WSS connections and CORP allowed cross-origin resource use although production is same-origin.
- Impact: weaker XSS exfiltration containment and unnecessary cross-origin resource exposure.
- Fix: `connect-src 'self'` and `Cross-Origin-Resource-Policy: same-origin`.
- Verification: application smoke output contains the tightened headers.

### SEC-08 — Upload endpoints lacked a focused abuse limit

- Severity: Low
- Affected: lost-and-found and incident image uploads
- Evidence: file size/count/type controls existed, but uploads relied only on the broad global request limiter.
- Impact: an authenticated abusive account could consume memory, bandwidth, and free storage quota faster than intended.
- Fix: shared per-user upload limiter of 10 upload requests per hour, applied before Multer parsing.
- Verification: lint/typecheck/build and middleware-order review.

## Important controls reviewed without a confirmed vulnerability

- SQL injection: Prisma APIs are parameterized; reviewed raw queries use tagged templates for advisory locks.
- XSS: React output encoding is used; no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` was found.
- CSRF/CORS: state-changing browser requests use same-site cookies and exact-origin CORS; hostile origins receive 403.
- Authorization/IDOR: admin router has global admin enforcement; booking/payment/QR/lost-and-found/driver services scope records to actor ownership or assignment.
- Booking races: serializable transactions, advisory locks, partial unique indexes, and database triggers protect active seat/student allocations.
- QR: signed, booking/trip/user-bound tokens are hashed in storage and atomically consumed once.
- Payments: bookings and passes are paid from prepaid credits inside the confirming transaction; balances cannot go negative, each money receipt can be credited once, every change is ledgered and audited, and no card details are handled.
- File upload/path traversal: bounded memory uploads, MIME allowlist, magic-byte checks, randomized names, strict filename regexes, private Supabase bucket, and encoded object keys are present.
- WebSockets: session, status, role, password-change, expiry, trip membership, and assignment checks are enforced server-side.
- Secrets: `.env` is not tracked; repository/history signature scans found no production secret. Test key strings are synthetic.
- Dependencies: `npm audit --audit-level=high` reports zero known vulnerabilities.

## Open risks and limitations

### TEST-01 — Critical-flow integration coverage is insufficient

- Severity: Medium engineering risk
- Coverage evidence: API 27.61% lines overall; the largest transactional services have limited automated execution coverage.
- Recommendation: add PostgreSQL-backed integration tests for simultaneous seat holds, booking/payment transitions, refund races, QR double scans, refresh-token reuse, role/IDOR matrices, maintenance conflicts, and WebSocket room authorization. Add Playwright coverage for student, driver, and admin happy/error paths.

### INFO-01 — Major dependency upgrades are available

Current installed dependencies have no npm advisory, but several newer major versions exist. Upgrade through separate compatibility work; do not combine major framework/ORM upgrades with security patches.

### INFO-02 — Free-tier availability constraints

The Render free service may cold-start or sleep and is not an availability/SLA platform. Supabase and Render quotas can interrupt a showcase even when application code is healthy. Configure uptime expectations, backups, and quota monitoring before real transport operations.

## Verification performed

- Full repository route/module/configuration review
- Non-destructive public browser checks of the live login application
- Live unauthenticated admin/session checks (401), hostile Origin check (403), HTTPS/header inspection, and console review
- Secret/history signature scan without printing secret values
- `npm audit --audit-level=high` — zero known vulnerabilities
- `npm run test:coverage` — all tests passed; coverage recorded above
- `npm run verify:release` — lint, typecheck, tests, production builds, Prisma validation, dependency audit

The live service was tested only through public and unauthenticated paths during this audit. No destructive test, payment, file creation, mass request, production data mutation, or denial-of-service action was performed. Code fixes must be committed and deployed before they protect the public URL.
