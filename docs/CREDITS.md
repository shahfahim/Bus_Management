# Student credits

UniRide has no online payment gateway. Students buy **credits** at the university office and spend
them on bus bookings and travel passes. One credit is worth one taka.

## How a student gets credits

1. The student pays the transport or accounts office (cash, or however the office accepts money) and
   receives a university money receipt.
2. An administrator opens **Admin → Credits → Add credits**, picks the student, enters the amount and
   the **money receipt number**, and saves.
3. The credits appear on the student's **Credits** page immediately and the student is notified.

Each money receipt number can be credited only once (matching ignores letter case), so the same
receipt cannot be entered twice by mistake or on purpose.

To correct a mistake, choose **Remove credits (correct a mistake)** and explain why in the note. The
student sees the note. A correction can never take the balance below zero.

## What credits pay for

| Action | What happens |
| --- | --- |
| Confirm a seat | The fare is taken from the balance in the same step that confirms the seat. With too few credits the booking is refused, nothing is charged, and the seat stays held until the timer ends so the student can top up. |
| Book with a bus pass | No credits are used; one trip on the pass is used instead. |
| Buy a bus pass | The price is taken from the balance and the pass starts immediately. |
| Booking created by an admin as *pending* | The student pays it from the booking page with **Pay with credits**. |

Every payment still gets a payment record and a receipt, so **Admin → Payments**, reports and
receipts work as before.

## Refunds

Cancelling a paid booking before departure, an administrator cancelling a booking or a trip, and
**Admin → Payments → Refund to credits** all return the full amount to the student's balance at once.
Refunds are always paid as credits, including for payments made by card before credits existed.

## Records

Every change to a balance is stored as a ledger entry with its type (top-up, booking, pass, refund,
correction), amount, the balance after it, the receipt or payment reference, and who recorded it.
Top-ups and corrections are also written to the audit log. Students see their own history on the
**Credits** page; administrators see everyone's in **Admin → Credits** and can filter and export it.

Safeguards in the database:

- the balance can never be negative (a check constraint, plus an atomic "only if the balance covers
  it" update, so two bookings at the same moment cannot overdraw);
- a money receipt number can be used for only one top-up;
- a retried payment request with the same `Idempotency-Key` returns the first result instead of
  charging again.

Cash handling, receipts and reconciliation with the university's accounts stay with the office; the
ledger export in **Admin → Credits** is there to support that reconciliation.
