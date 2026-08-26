# Architecture

## Shape of the system

UniRide is an npm-workspace monorepo with one independently buildable API and one single-page web client.

```text
React/Vite client
  ├─ REST over HTTPS ───────────────┐
  ├─ Socket.IO authenticated rooms ─┤
  └─ browser GPS / camera / push ───┤
                                     ▼
Express API ─ domain services ─ Prisma ─ PostgreSQL
    │              │
    │              ├─ Stripe Checkout + signed webhook verification
    │              └─ Web Push (VAPID)
    └─ Socket.IO event hub
```

Routes validate untrusted input with Zod, enforce authentication and role policy, and call domain services. Services own transaction boundaries and side effects. Prisma is the only database access layer. The React client keeps transport concerns in `src/lib` and domain presentation in route-level pages and reusable components.

## Modules

- `auth`: role-aware student/teacher/driver registration, administrator approval, login throttling, short-lived access JWTs, rotating refresh sessions, forced temporary-password replacement, logout, and current-user identity.
- `tracking`: assigned-trip controls, GPS updates, incidents, and driver-created custom trips. Custom trip creation atomically creates its route, two stops, trip timings, and audit record after assignment, licence, maintenance, overlap, and abuse-limit checks.
- `catalog`: public buses, routes, stops, trips, route alerts, latest trip position, and authoritative seat availability.
- `bookings`: expiring seat holds, booking confirmation/cancellation, subscription use, and ownership checks.
- `tracking`: driver assignments, trip lifecycle, adaptive GPS ingestion, ETA calculation, passenger manifests, incidents, and offline/degraded tracking state.
- `qr`: signed booking-bound QR tokens and atomic, auditable, single-use check-in.
- `subscriptions`: route-scoped travel-pass catalog, student pass history, booking eligibility, and remaining-ride accounting.
- `payments`: Stripe Checkout, verified/idempotent webhooks, receipts, cumulative/out-of-order refund reconciliation, and payment/subscription lifecycle.
- `notifications`: in-app history, read state, push subscriptions, Web Push delivery, deduplication, real-time delivery, and bounded retry processing.
- `maintenance` and `road-alerts`: admin lifecycle management and affected-student notification fan-out.
- `lost-found`: reports, safe image uploads, search, match scoring, claim review, and match notifications.
- `ratings`: eligibility based on completed/checked-in bookings and transactional driver aggregates.
- `admin`: fleet, route, trip, people, booking, payment, check-in, incident triage, lost-item claims/matches, communication, audit, and analytics operations.

## Critical invariants

PostgreSQL, not the browser, is the final authority for business rules.

- Partial unique indexes prevent two active allocations for a trip seat, two active bookings for the same student/trip, multiple active QR codes, and repeated accepted check-ins.
- Booking, payment, QR, expiry, trip completion, and cancellation transitions share row-level booking locks and guarded updates so competing workflows cannot overwrite one another.
- Bus scheduling and maintenance changes share advisory locks. A maintenance window cannot overlap an active/scheduled trip, and the bus returns to its exact pre-maintenance state.
- A seat hold has a server timestamp and is expired by both request-time checks and a monitor.
- Payment checkout is serialized per payable resource. Client and provider idempotency keys are separate defenses. Only signed Stripe webhook events can mark a payment successful.
- A late successful payment cannot reclaim an expired seat; it enters the refund workflow. Stripe refunds are reconciled cumulatively even when charge/refund webhook events arrive out of order.
- QR payloads are signed, random-ID bound, user/booking/trip bound, expiry bound, stored only as hashes, and consumed atomically.
- GPS timestamps, coordinates, assignment, trip state, throttling, and replay age are validated server-side.
- ETA alerts use route progress, stop timing, recent speed, and active road-alert multipliers rather than straight-line distance alone.
- Every admin mutation records actor, request ID, IP/user agent, entity, and before/after state where applicable.

## Authentication and authorization

Passwords use bcrypt with cost 12. Admin-created accounts must replace their temporary password before using protected domain APIs. Access tokens are short-lived. Refresh tokens are kept in HTTP-only cookies, stored as hashes, rotated on each refresh, and the session family is revoked on replay/logout. The UI stores the access token in session storage; all resource-level ownership remains enforced by the API.

RBAC roles are `STUDENT`, `TEACHER`, `DRIVER`, `CONDUCTOR`, and `ADMIN`. Teachers use rider features without being asked for a student ID. Route guards provide a first check; domain services also validate assignment and ownership. Admin-only routes are guarded before handlers run.

Security middleware includes Helmet, exact-origin credentialed CORS, bounded request bodies, endpoint and global rate limiting, structured request IDs/logs, MIME and file-signature image checks, randomized filenames, and normalized error responses. No raw card data enters this system.

## Real-time and device behavior

Socket.IO authenticates a JWT during connection and joins user and role rooms. Trip rooms are joined explicitly. The API emits location, trip status, seat availability, check-in, and notification events.

Driver GPS uses browser `watchPosition` with adaptive upload cadence: approximately 10 seconds while moving, 30 seconds while stationary, and 60 seconds while the page is hidden. A single latest point is buffered during network loss and marked as an offline replay when sent. The server rejects stale or implausible updates and exposes degraded tracking without ending the trip.

## Operational notes

- Run migrations before starting a new API release.
- Readiness checks include PostgreSQL; liveness checks only the process.
- The API handles `SIGTERM`/`SIGINT`, stops monitors, closes HTTP, and disconnects Prisma.
- In-process monitors handle seat-hold expiry, maintenance reconciliation, GPS health, and bounded notification retries. Run one scheduler instance until distributed scheduling or dedicated workers are introduced; notification delivery itself also uses a database claim to prevent duplicate sends.
- Local uploaded media is appropriate for a single instance; use object storage and malware scanning for a horizontally scaled deployment.
- Structured logs go to stdout and should be collected by the hosting platform.

## Current external-service boundaries

Development is fully usable without Stripe or VAPID except for real payments and browser push. ETA is based on stored route timing, live GPS, and internal alert multipliers; connecting a traffic-routing provider would improve road-network precision. Email verification, SMS delivery, and MFA are not included.
