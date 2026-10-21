# AI Training — registration site

Registration page for the AI Training workshop (21 & 22 November 2026, Kalika Steels, Jalna, ₹3,499).
People register and either pay online through Razorpay Checkout or choose to pay in cash. Every
registration is one row in a Google Sheet.

- Static `index.html` at the root, styled with the MonoEdge Systems design system tokens.
- Vercel Node.js functions in `/api` (Web handlers, ESM, Node 24).
- One dependency: `google-auth-library` for the Sheets service account. Razorpay is called with `fetch`.

## How it works

| Endpoint | Does | Writes to sheet |
| --- | --- | --- |
| `POST /api/create-order` | Validates input, creates a Razorpay order for 349900 paise (server constant), appends a `payment_pending` row | Appends row |
| `POST /api/verify-payment` | Checks the Checkout signature `HMAC_SHA256(order_id\|payment_id, KEY_SECRET)` so the page can say "Payment received" | Never |
| `POST /api/razorpay-webhook` | Verifies `X-Razorpay-Signature` on the raw body; the only writer of online payment status | Updates status |
| `POST /api/register-cash` | Validates input, appends a `cash_pending` row | Appends row |

Statuses: `payment_pending` → `paid` or `payment_failed` (online, set by the webhook);
`cash_pending` → `cash_received` (you change this by hand in the sheet).

Webhook rules:

- `payment.captured` sets `paid` (from `payment_pending` or `payment_failed`) and stores the payment ID.
- `payment.failed` sets `payment_failed` only from `payment_pending`. It never touches a `paid` row.
- Duplicate deliveries are no-ops: every transition checks the current status first.
- Bad signature: logged, `400`.
- Valid signature but irrelevant (other events, orders not in the sheet): `200`.
- Valid signature but the sheet or Razorpay API could not be reached: `500`, so Razorpay redelivers.
  Razorpay retries for 24 hours and then stops, so this cannot loop forever. Returning `200` here
  would lose a real payment.
- Google Sheets has no compare-and-set. A `payment.failed` handler can read `payment_pending`, a
  `payment.captured` handler can write `paid` in between, and the failed handler then overwrites it.
  To close that window, after writing `payment_failed` the handler asks Razorpay whether the order
  has a captured payment and restores `paid` if so.

Sheet writes use `valueInputOption=RAW`. Names starting with `=` stay text, and phone numbers stay
10-digit strings.

## Google Sheet

The sheet is already created:
[AI Training Registrations](https://docs.google.com/spreadsheets/d/1bZi0htmQgUjDUyhyHqYNlql7Z45QoPFInPtNExx0Fag/edit).

- Its ID (`GOOGLE_SHEET_ID`) is `1bZi0htmQgUjDUyhyHqYNlql7Z45QoPFInPtNExx0Fag`.
- It has the `Registrations` tab and the header row, with the first row frozen.
- The Status column has a dropdown of the five statuses.

If you ever need to recreate it, create an empty Google Sheet, share it with the service account
(step 6 below), then run:

```sh
npm install
node --env-file=.env scripts/init-sheet.js
```

The script creates the `Registrations` tab and header if they are missing. It refuses to overwrite
a different header.

### Service account (one time)

1. Go to https://console.cloud.google.com/ and create a project (e.g. `ai-training-registrations`).
2. **APIs & Services → Library** → search **Google Sheets API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**. Name it e.g. `sheets-writer`.
   Skip the optional role and user-access steps → **Done**.
4. Open the new service account → **Keys → Add key → Create new key → JSON → Create**.
   A `.json` file downloads. Treat it as a password.
   - If key creation is blocked by an organisation policy (`iam.disableServiceAccountKeyCreation`),
     an org admin has to allow it for this project.
5. Base64-encode the whole file into one line:
   - macOS: `base64 -i key.json | tr -d '\n' | pbcopy` (now on your clipboard)
   - Linux: `base64 -w0 key.json`
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json")) | Set-Clipboard`

   This value is `GOOGLE_SERVICE_ACCOUNT_KEY_B64`.
6. Copy the `client_email` from the JSON (looks like `sheets-writer@<project>.iam.gserviceaccount.com`).
   Open the sheet → **Share** → paste that email → **Editor** → untick "Notify" → **Share**.
7. Delete the downloaded `key.json` once it is stored in Vercel.

## Vercel (step by step)

1. https://vercel.com/new → under **Import Git Repository**, pick `Rubanzer/AI-Training`.
   - If it is not listed, click **Adjust GitHub App Permissions** and grant access to that repo.
2. On the configure screen:
   - **Project name:** `ai-training`
   - **Framework Preset:** `Other`
   - **Root Directory:** `./`
   - Leave Build and Output settings empty or default.
3. Open **Environment Variables** on the same screen and add the five variables from `.env.example`.
   Start with **Razorpay test keys** so you can run the checklist before going live:

   | Name | Value |
   | --- | --- |
   | `RAZORPAY_KEY_ID` | `rzp_test_…` from Razorpay (test mode) |
   | `RAZORPAY_KEY_SECRET` | the matching test secret |
   | `RAZORPAY_WEBHOOK_SECRET` | a long random string you make up, e.g. from `openssl rand -hex 32`. Use the same value in the Razorpay webhook (below) |
   | `GOOGLE_SERVICE_ACCOUNT_KEY_B64` | the one-line base64 from step 5 above |
   | `GOOGLE_SHEET_ID` | `1bZi0htmQgUjDUyhyHqYNlql7Z45QoPFInPtNExx0Fag` |

   Leave all environments (Production, Preview, Development) ticked.
4. Click **Deploy**. When it finishes you get a URL like `https://ai-training-xxxx.vercel.app`.
5. Add the domain: **Project → Settings → Domains → Add** → `training.monoedge.in` → **Add**.
   Vercel then shows a DNS record to create, normally a **CNAME** for `training`. Copy the exact
   value it shows; recent projects get a project-specific target.
6. In GoDaddy: **My Products → monoedge.in → DNS → Add New Record**:
   - **Type:** CNAME
   - **Name:** `training`
   - **Value:** the target Vercel showed
   - **TTL:** default

   Save. Vercel's Domains page turns to **Valid Configuration** once DNS propagates (usually
   minutes) and issues the HTTPS certificate automatically.
   - If monoedge.in's nameservers point to Vercel rather than GoDaddy, add the record in Vercel's
     DNS instead. GoDaddy's DNS page tells you which nameservers are in use.
7. Changing an environment variable later only takes effect on the next deployment:
   **Deployments → ⋯ → Redeploy**.

## Razorpay (step by step)

Do everything in **Test Mode** first (toggle at the top of the Dashboard), run `TESTING.md`, then
repeat steps 1 and 3 in **Live Mode**.

1. **API keys:** **Account & Settings → API Keys** (or **Settings → API Keys**) → **Generate Key**.
   Copy the Key ID and Key Secret into Vercel as `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. The
   secret is shown only once.
2. **Auto-capture:** **Account & Settings → Payments Capture**. Confirm **Automatic Capture** is on
   (it is the default). If it is not, click **Change** → choose a capture window → **Next** →
   refund speed **Normal** → **Save**. Without auto-capture, payments stay "authorized", no
   `payment.captured` event arrives, and rows stay `payment_pending`.
3. **Webhook:** **Account & Settings → Webhooks** (under *Website and app settings*) →
   **+ Add New Webhook**:
   - **URL:** `https://training.monoedge.in/api/razorpay-webhook`. Until the domain is live, use
     the `https://ai-training-xxxx.vercel.app/api/razorpay-webhook` URL, then edit it later.
   - **Secret:** the same string you put in `RAZORPAY_WEBHOOK_SECRET`.
   - **Alert Email:** your email. Razorpay warns you here if deliveries fail.
   - **Active Events:** tick `payment.captured` and `payment.failed` only.
   - **Create Webhook.** In test mode it may ask for an OTP; Razorpay's documented test-mode OTP
     is `754081`.
4. **Going live:**
   - Generate live keys and replace `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in Vercel.
   - Create the webhook again in Live Mode with a new secret, and put that secret in
     `RAZORPAY_WEBHOOK_SECRET`.
   - Redeploy.
   - Delete the test rows from the sheet.

Test-mode webhooks only receive test payments, and live-mode webhooks only live ones.

## Local development

```sh
npm install
npm test                      # unit + handler tests, no network
cp .env.example .env          # fill in, never commit
npx vercel dev                # runs index.html and /api locally
```

## Files

```
index.html                 the page
assets/                    MonoEdge logo files (from the design system)
api/*.js                   Vercel function entry points (thin)
lib/handlers.js            request logic, with I/O injected for tests
lib/validate.js            input rules, shared by browser and server
lib/sheets.js              Google Sheets access (RAW writes)
lib/razorpay.js            Razorpay REST calls
lib/config.js              fee, statuses, env access
scripts/init-sheet.js      one-time sheet setup
test/                      node:test suites
TESTING.md                 test-mode checklist and results
```
