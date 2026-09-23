# Bus door readers and boarding cards

Every student gets one personal **boarding card**: a Code 128 barcode created when the account is
created. The same card is used for every trip. A networked barcode reader at each bus door sends every
scan to UniRide, which checks the rider in only if they have a **paid booking** on the trip that bus is
running. Boarding uses up that booking, so the same card is refused on the next ride until the student
books and pays again.

## How a scan is decided

1. The reader authenticates with its own API key. Each reader belongs to one bus.
2. The code is looked up. Unknown codes, and codes of suspended or removed accounts, are refused.
3. The bus's boardable trips are those from 45 minutes before departure until the trip ends
   (`SCHEDULED` within 45 minutes, or `BOARDING`, `IN_PROGRESS`, `DELAYED`).
4. The student's `CONFIRMED` (paid, or covered by a pass) booking on one of those trips is switched to
   `CHECKED_IN`, and the seat is marked as boarded. This happens once: two readers scanning at the same
   moment cannot both use the booking.
5. Every accepted and refused scan is recorded in the check-in log (Admin → Check-ins) with the reader
   that made it.

The barcode holds only a random identifier (`UR` + 20 hex digits). It contains no trip, stop or
personal data; everything is looked up at scan time.

Because of that, routes, stops and trips an administrator adds or changes work with every existing
card immediately. The student's **Boarding card** page lists, live from their bookings, the upcoming
trips the card will board (route, boarding and destination stop, time, bus and seat, and whether the
booking is paid). It refreshes when a booking changes, when the student returns to the page, and
every minute while it is open.

## Setting up a reader

1. In **Admin → Door readers**, choose **Add door reader**, give it a name and pick its bus.
2. Copy the API key that is shown once. Only a hash is stored, so it cannot be displayed again. If it
   is lost or exposed, use **Rotate key**; the old key stops working immediately.
3. Configure the reader to send each scan to the API as described below.

Removing a reader that has already scanned riders revokes it instead of deleting it, so the check-in
history keeps pointing at it.

## Reader API

```
POST {API_ORIGIN}/api/boarding/check-ins
X-Door-Reader-Key: <reader API key>
```

The body can be any of:

- `text/plain`: the scanned code on its own, e.g. `UR0123456789ABCDEF0123`
- `application/json`: `{ "code": "UR0123456789ABCDEF0123" }` (`barcode` is also accepted)
- `application/x-www-form-urlencoded`: `code=UR0123456789ABCDEF0123`

Spaces, dashes and lower case are ignored, so a code typed from the card also works.

### Responses

| Status | Body `code` | Meaning | Suggested signal |
| --- | --- | --- | --- |
| `200` | (none, `accepted: true`) | Rider checked in; `message` reads e.g. "Welcome, Nadia · seat 7" | Green / open |
| `404` | `UNKNOWN_CODE` | Card not recognised | Red |
| `409` | `NO_BOOKING` | No paid booking for this bus | Red |
| `409` | `PAYMENT_PENDING` | Booking exists but is not paid | Red |
| `409` | `ALREADY_CHECKED_IN` | This booking was already used to board | Red |
| `409` | `NO_ACTIVE_TRIP` | The bus has no trip boarding right now | Red |
| `401` | `READER_KEY_REQUIRED` / `READER_NOT_AUTHORISED` | Missing, wrong, inactive or revoked key | Red, alert staff |
| `429` | `RATE_LIMITED` | More than 240 scans a minute from this reader | Retry shortly |

Accepted example:

```json
{
  "accepted": true,
  "message": "Welcome, Nadia Rahman · seat 7",
  "passenger": { "name": "Nadia Rahman", "studentId": "CSE-2201", "seatNumber": "7" },
  "trip": { "id": "…", "publicCode": "TRIP-20260924-1A2B3C4D-9F0E" },
  "bookingId": "…",
  "checkInId": "…",
  "checkedInAt": "2026-09-24T02:25:41.000Z"
}
```

Refused example:

```json
{ "accepted": false, "code": "NO_BOOKING", "message": "No paid booking for this bus", "passenger": { "name": "Nadia Rahman", "studentId": "CSE-2201" } }
```

Test a reader key from a terminal:

```bash
curl -i -X POST https://your-api/api/boarding/check-ins -H "X-Door-Reader-Key: drk_…" -H "Content-Type: text/plain" --data "UR0123456789ABCDEF0123"
```

## If a reader is down

The assigned driver or conductor can open the trip in **My Trips → Manual check-in** and type the
code printed under the rider's barcode. The same rules apply.

## Limits to be aware of

- A barcode can be photographed or photocopied. The rider's name is returned with every scan so staff
  can glance-check it, each booking still boards only once, and a student can reissue their card from
  **Boarding card → Reissue code**, which invalidates the old barcode at once.
- Readers need a network connection. Scans are not queued offline.
