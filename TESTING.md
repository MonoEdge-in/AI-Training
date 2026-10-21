# Test checklist (Razorpay Test Mode)

Run this on the deployed site with **test keys** and a **test-mode webhook** before switching to
live keys. Test payments move no money.

- **UPI:** in Checkout choose UPI and enter `success@razorpay` to succeed or `failure@razorpay` to fail.
- **Cards:** use a test card from Razorpay's test-integration docs, with any future expiry and any CVV.

After each case, check the sheet row and the webhook delivery log:
**Razorpay Dashboard → Account & Settings → Webhooks → (your webhook) → deliveries**.

| # | Case | Steps | Expected |
| --- | --- | --- | --- |
| 1 | Successful payment | Register with "Pay online", pay with `success@razorpay` | Page shows "Payment received" and an `AIW-` ID. The row goes `payment_pending` → `paid` within seconds, with the Razorpay Order ID and Payment ID filled |
| 2 | Failed, then retry succeeds | Register, pay with `failure@razorpay`, then retry in the same Checkout window with `success@razorpay` | Row goes `payment_pending` → `payment_failed` → `paid`. The payment ID becomes the successful one. One row only |
| 3 | Closed checkout | Register, then close the Checkout window without paying | Page shows "Payment not completed" with the ID. Row stays `payment_pending`. "Try payment again" reopens Checkout for the same order |
| 4 | Duplicate webhook delivery | After case 1, open that delivery in the webhook log and click **Resend** (if offered), or replay it with the original headers | Response `200`. Row unchanged, Updated At unchanged |
| 5 | Tampered signature rejected | `curl -X POST https://<site>/api/razorpay-webhook -H 'content-type: application/json' -H 'x-razorpay-signature: 0000000000000000000000000000000000000000000000000000000000000000' -d '{"event":"payment.captured"}'` | Response `400`. "bad signature" in Vercel logs. No sheet change |
| 6 | Cash registration | Register with "Pay in cash" | Page shows the JSC Seed Private Limited instructions and the ID. Row has `cash` / `cash_pending`, with no order ID |
| 7 | Invalid inputs | Empty form; phone `12345`; bad email; 1,501-character expectations. Also post junk straight to `/api/create-order` with curl | Field messages on the page; nothing sent. The API returns `400` with field errors, and no row or Razorpay order is created |
| 8 | Late failure never downgrades | Covered by automated tests (`webhook: late failed event never overwrites paid`, `…racing a capture restores paid`) | `paid` stays `paid` |
| 10 | Voice input | On an Android phone in Chrome, tap Speak in the expectations box, allow the microphone, say a sentence, tap Stop. Repeat on an iPhone | Spoken text appears in the box, appended to anything already typed, with no repeated words. If the microphone is denied, a clear message appears. On browsers without speech recognition, the button is hidden |
| 9 | Manual cash update | Change a `cash_pending` row to `cash_received` in the sheet | Nothing in the app overwrites it |

## Results

Recorded 21 Oct 2026.

### Verified without live services

- **`npm test`: 32 of 32 pass.** These run the real handler code against in-memory fakes for the
  sheet and the Razorpay API. They cover:
  - server-side amount (any browser `amount` is ignored)
  - validation and phone normalisation
  - Checkout signature accept and reject
  - captured, failed, then retry → paid
  - duplicate captured delivery is a no-op
  - a late failure never overwrites paid
  - the failed/captured race restoring paid from Razorpay
  - redelivery after a mid-way error
  - tampered body, wrong secret and missing signature → `400`
  - signature checked on raw bytes (a re-serialised check would fail)
  - unknown orders and other events → `200`, no write
  - sheet outage → `500`
  - cash rows never touched
  - IST timestamps
- **Browser run after the second redesign (two-step form, sticky booking card; Chromium at 320, 390 and 1280 px): 43 of 43 checks pass.** On top of the payment, cash, voice and validation checks, this covers:
  - step 1 blocks Continue until name, mobile and email are valid; errors show on leaving a field and clear once fixed
  - Back keeps entered values; server errors on step-1 fields send the user back to step 1
  - on desktop the booking card sits beside the hero and stays in view while scrolling
  - the sticky bar on phones is hidden over the hero button and the booking card
  - FAQ opens
- **Browser run after the first redesign (Chromium at 320, 390 and 1280 px, light and dark): 34 of 34 checks pass.** Added checks:
  - voice input with a simulated recognizer: appends to typed text with no duplication, counter updates, stop works
  - denied microphone shows a message
  - mic hidden when the browser lacks speech recognition
  - sticky register bar hides over the form
  - Saturday/Sunday dates, contact, website and trainer LinkedIn present

  Real speech recognition was not tested; it needs a real phone and microphone (case 10).
- **Earlier browser run (Chromium, 390 px and 320 px wide, light and dark): 21 of 21 checks pass.** Real
  page, real API handlers, fake sheet, stubbed Razorpay Checkout. Covered:
  - no horizontal scroll
  - client-side errors with no request sent
  - success view, with the order ID, amount and `+91` prefill passed to Checkout
  - the verify step not writing to the sheet
  - closed-checkout view, and retry reusing the same order with no extra row
  - signature-mismatch view
  - cash view with the exact instructions
  - rapid double submit creates one row
  - server rejects invalid input with `400`
  - Checkout script blocked → error view with the ID

### Not yet verified, needs your test keys and a deployment

Cases 1–7 above against real Razorpay test mode and the real sheet. These also exercise:

- `lib/sheets.js` (Google auth, the append, and finding a row by order ID)
- `lib/razorpay.js`
- Vercel serving `/lib/validate.js` to the browser

None of that has run against the live services yet.
