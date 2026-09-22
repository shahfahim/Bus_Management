# API summary

The same interface is mounted at `/api` and `/api/v1`. JSON is used unless an image upload is explicitly noted. Errors have the shape:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable message",
    "details": {},
    "requestId": "request-id"
  }
}
```

The browser client authenticates with secure, HTTP-only, same-site cookies. Session credentials are never returned in JSON or stored in browser JavaScript storage. Refresh tokens are rotated on every refresh. List endpoints accept bounded `page`/`pageSize` parameters and domain filters.

## Authentication and profile

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | Submit a student account for administrator verification (HTTP 202). Driver, conductor, and admin accounts are created by an administrator. |
| POST | `/auth/login` | Public | Authenticate and create a rotating session |
| POST | `/auth/refresh` | Refresh cookie | Rotate refresh/access tokens |
| POST | `/auth/logout` | Authenticated | Revoke the current session |
| GET | `/auth/me` | Authenticated | Current profile |
| POST | `/auth/change-password` | Authenticated | Replace a temporary/current password and revoke other sessions |
| PATCH | `/users/me` | Authenticated | Update own profile |
| GET | `/dashboard/summary` | Authenticated | Role-aware dashboard summary |

## Student and catalog

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/buses` | Available fleet and current status |
| GET | `/routes`, `/routes/:id` | Route/stop catalog and active alerts |
| GET | `/trips`, `/trips/:id` | Search scheduled trips, including origin-before-destination filtering |
| GET | `/trips/:id/seats` | Authoritative real-time seat state |
| GET | `/trips/:id/location` | Latest bus location and tracking state |
| POST/DELETE | `/trips/:id/seat-holds` | Create/release an expiring server seat hold |
| GET | `/subscription-plans` | Active travel passes |
| GET | `/subscriptions` | Own pass history; filter by status or route |
| GET/POST | `/bookings` | Own booking history / confirm a hold or create a booking |
| GET | `/bookings/:id` | Own booking details |
| POST or DELETE | `/bookings/:id/cancel` or `/bookings/:id` | Cancel and release a booking before the trip departs (`TRIP_ALREADY_DEPARTED` afterwards) |
| GET or POST | `/bookings/:id/qr` | Get/rotate the active boarding QR |
| GET/POST/PATCH/DELETE | `/ratings` | Eligible journeys and own driver reviews |

## Driver and entry

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/driver/profile` | Driver profile and assignment summary |
| GET | `/driver/trips`, `/driver/trips/:id` | Assigned trips |
| GET | `/driver/trip-setup/options` | Active assigned buses and campus preset for custom-trip setup |
| POST | `/driver/trips` | Create a custom scheduled trip between any two validated map coordinates using an assigned bus |
| POST | `/driver/trips/:id/start` | Start an assigned trip, at most 60 minutes before its scheduled departure |
| POST | `/driver/trips/:id/end` | Complete an assigned trip |
| GET | `/driver/trips/:id/passengers` | Passenger/check-in manifest |
| POST | `/driver/location` | Throttled GPS sample (supports offline replay metadata) |
| POST | `/driver/check-ins/scan` | Atomically validate and consume a QR |
| POST | `/driver/incidents` | Driver incident report; multipart with optional `image` |

## Admin driver assignments

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/admin/assignments` | List assignments / authorize a verified driver to use an active bus |
| GET/PATCH/DELETE | `/admin/assignments/:id` | Inspect, update, cancel, or remove an unused assignment |

Active and scheduled windows cannot overlap for the same driver or bus. Assignments referenced by trips remain in the audit trail and must be cancelled instead of deleted.

## Payments and notifications

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/payments/checkout` | Create/resume booking or subscription Stripe Checkout; send `Idempotency-Key` |
| GET | `/payments` | Own payment history |
| GET | `/payments/:id/receipt` | Authorized digital receipt |
| POST | `/payments/:id/refund` | Admin refund |
| POST | `/webhooks/stripe` | Raw-body, signature-verified Stripe webhook |
| GET/PATCH | `/notifications` | Paginated inbox / mark notifications read |
| GET | `/notifications/unread-count` | Unread counter |
| GET | `/notifications/push-config` | Public VAPID key |
| POST/DELETE | `/notifications/push-subscriptions` | Register/revoke browser push |

## Operations and community

- `/maintenance`: public/authenticated reads and admin create/update/delete. Maintenance updates synchronize bus state and notify affected bookings.
- `/road-alerts`: active route alerts plus admin lifecycle operations for traffic, blockage, accident, construction, weather, and other categories.
- `/lost-found`: searchable reports, own reports, multipart safe image upload, update/delete, claims, and admin match/claim review (`PATCH /claims/:id` and `PATCH /matches/:id`).

## Administration

All `/admin/*` endpoints require `ADMIN`. Resource families include:

- `/admin/overview`, `/admin/reports`, `/admin/audit-logs`
- `/admin/buses`, `/admin/routes`, `/admin/stops`, `/admin/trips`
- `/admin/users`, `/admin/bookings`, `/admin/payments`, `/admin/checkins`
- `/admin/maintenance`, `/admin/road-alerts`, `/admin/lost-found`, `/admin/incidents`
- `/admin/ratings`, `/admin/notifications`
- `/admin/schedules` (recurring trip schedules)

Each family provides the safe operations valid for that resource. Financial and accepted check-in records are immutable; corrections use refund/revoke actions rather than destructive edits.

Editing a schedule reconciles its already generated future trips: trips that no longer match the new route, bus, days, validity window or departure time are cancelled through the normal trip-cancellation path (seats released, payments refunded, riders notified), and matching trips keep their bookings and take the new driver and fare. Deleting an unused trip that came from a schedule cancels it instead, so the generator does not recreate it.

## Socket.IO

Connect to the API origin with `{ auth: { token } }`. The server joins `user:<id>` and `role:<role>` rooms after verifying the access JWT. Clients join a trip room with `trip:join`: administrators any trip, drivers and conductors their assigned trips, and riders any scheduled or active trip (whose position and seat availability are already public) or a trip they have booked. Trip-room events never carry per-viewer fields.

Important events include:

- `trip:location`
- `trip:status` and compatibility event `trip:updated`
- `trip:seats`
- `check-in:new` and compatibility event `checkin:created`
- `booking:updated`
- `notification:new`
- `notifications:read`

The REST API remains authoritative after reconnect; clients should refetch current state rather than replaying missed socket events.
