// Request handlers with their I/O injected, so the same code runs on Vercel and under test.
import { AMOUNT_INR, AMOUNT_PAISE, CURRENCY, STATUS, env as realEnv } from './config.js';
import * as realRazorpay from './razorpay.js';
import * as realSheets from './sheets.js';
import { hmacMatches, json, newRegistrationId, nowIST, readJson } from './util.js';
import { validateRegistration } from './validate.js';

export const defaultDeps = {
  sheets: realSheets,
  razorpay: realRazorpay,
  env: realEnv,
  now: nowIST,
  newId: newRegistrationId,
  log: console,
};

async function uniqueRegistrationId(deps) {
  for (let i = 0; i < 5; i++) {
    const id = deps.newId();
    if (!(await deps.sheets.registrationIdExists(id))) return id;
  }
  throw new Error('Could not generate a unique registration ID');
}

function baseRecord(data, registrationId, paymentMethod, status, now) {
  return {
    createdAt: now,
    registrationId,
    status,
    paymentMethod,
    ...data,
    amountInr: AMOUNT_INR,
    orderId: '',
    paymentId: '',
    updatedAt: now,
  };
}

async function validatedBody(request) {
  const body = await readJson(request);
  const result = validateRegistration(body);
  if (!result.ok) return { error: json(400, { ok: false, errors: result.errors }) };
  return { data: result.data };
}

export async function createOrder(request, deps = defaultDeps) {
  const { data, error } = await validatedBody(request);
  if (error) return error;
  try {
    const registrationId = await uniqueRegistrationId(deps);
    const order = await deps.razorpay.createOrder({
      amount: AMOUNT_PAISE,
      currency: CURRENCY,
      receipt: registrationId,
      notes: { registration_id: registrationId },
    });
    const now = deps.now();
    await deps.sheets.appendRow({
      ...baseRecord(data, registrationId, 'online', STATUS.PAYMENT_PENDING, now),
      orderId: order.id,
    });
    return json(200, {
      ok: true,
      registrationId,
      orderId: order.id,
      keyId: deps.env('RAZORPAY_KEY_ID'),
      amount: AMOUNT_PAISE,
      currency: CURRENCY,
      prefill: { name: data.name, email: data.email, contact: `+91${data.phone}` },
    });
  } catch (err) {
    deps.log.error('create-order failed', err);
    return json(500, { ok: false, message: 'We could not start the payment. Nothing was charged. Please try again.' });
  }
}

export async function registerCash(request, deps = defaultDeps) {
  const { data, error } = await validatedBody(request);
  if (error) return error;
  try {
    const registrationId = await uniqueRegistrationId(deps);
    await deps.sheets.appendRow(baseRecord(data, registrationId, 'cash', STATUS.CASH_PENDING, deps.now()));
    return json(200, { ok: true, registrationId, amount: AMOUNT_INR });
  } catch (err) {
    deps.log.error('register-cash failed', err);
    return json(500, { ok: false, message: 'We could not save your registration. Please try again.' });
  }
}

// Confirms the Checkout result for the UI only. It never writes to the sheet:
// the webhook is the single writer of online payment status.
export async function verifyPayment(request, deps = defaultDeps) {
  const body = (await readJson(request)) ?? {};
  const orderId = body.razorpay_order_id;
  const paymentId = body.razorpay_payment_id;
  const signature = body.razorpay_signature;
  if (typeof orderId !== 'string' || !/^order_\w+$/.test(orderId)
      || typeof paymentId !== 'string' || !/^pay_\w+$/.test(paymentId)) {
    return json(400, { ok: false });
  }
  const ok = hmacMatches(`${orderId}|${paymentId}`, deps.env('RAZORPAY_KEY_SECRET'), signature);
  return json(ok ? 200 : 400, { ok });
}

export async function razorpayWebhook(request, deps = defaultDeps) {
  // The signature covers the exact bytes Razorpay sent, so hash those before any parsing.
  const raw = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get('x-razorpay-signature');
  const eventId = request.headers.get('x-razorpay-event-id') ?? '-';
  if (!hmacMatches(raw, deps.env('RAZORPAY_WEBHOOK_SECRET'), signature)) {
    deps.log.warn(`webhook rejected: bad signature (event ${eventId})`);
    return json(400, { ok: false });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    deps.log.error(`webhook ${eventId}: signed body is not JSON`);
    return json(200, { ok: true, ignored: 'unparseable' });
  }

  const type = event?.event;
  const payment = event?.payload?.payment?.entity;
  if ((type !== 'payment.captured' && type !== 'payment.failed') || !payment?.order_id) {
    return json(200, { ok: true, ignored: type ?? 'unknown' });
  }

  try {
    const outcome = type === 'payment.captured'
      ? await onCaptured(payment, deps)
      : await onFailed(payment, deps);
    deps.log.info(`webhook ${eventId} ${type} ${payment.order_id} ${payment.id}: ${outcome}`);
    return json(200, { ok: true, outcome });
  } catch (err) {
    // A valid event we could not record (Sheets or Razorpay unreachable). A non-2xx makes
    // Razorpay redeliver it; it retries for up to 24 hours, so this does not loop forever.
    deps.log.error(`webhook ${eventId} ${type} ${payment.order_id}: processing failed`, err);
    return json(500, { ok: false });
  }
}

async function onCaptured(payment, deps) {
  if (payment.amount !== AMOUNT_PAISE || payment.currency !== CURRENCY) {
    deps.log.error(`captured payment ${payment.id} has unexpected amount ${payment.amount} ${payment.currency}`);
    return 'amount_mismatch_not_recorded';
  }
  const row = await deps.sheets.findByOrderId(payment.order_id);
  if (!row) return 'unknown_order';
  if (row.status === STATUS.PAID) return row.paymentId === payment.id ? 'duplicate' : 'already_paid';
  if (row.status !== STATUS.PAYMENT_PENDING && row.status !== STATUS.PAYMENT_FAILED) {
    return `unexpected_status_${row.status}`;
  }
  await deps.sheets.updatePaymentStatus(row.rowNumber, {
    status: STATUS.PAID, paymentId: payment.id, updatedAt: deps.now(),
  });
  return 'marked_paid';
}

async function onFailed(payment, deps) {
  const row = await deps.sheets.findByOrderId(payment.order_id);
  if (!row) return 'unknown_order';
  // A late or redelivered failure must never move a row out of paid.
  if (row.status !== STATUS.PAYMENT_PENDING && row.status !== STATUS.PAYMENT_FAILED) {
    return `kept_${row.status || 'empty'}`;
  }

  if (row.status === STATUS.PAYMENT_PENDING) {
    await deps.sheets.updatePaymentStatus(row.rowNumber, {
      status: STATUS.PAYMENT_FAILED, paymentId: payment.id, updatedAt: deps.now(),
    });
  }

  // Sheets has no compare-and-set, so a payment.captured for a retry on this order could
  // have been recorded between our read and our write above, and we just overwrote it.
  // Any capture that could race us already exists at Razorpay by now, so re-check there
  // and restore paid if needed. This also runs when a redelivery finds the row already
  // failed, in case an earlier attempt wrote failed and then errored before this check.
  const captured = (await deps.razorpay.fetchOrderPayments(payment.order_id))
    .find((p) => p.status === 'captured');
  if (captured) {
    await deps.sheets.updatePaymentStatus(row.rowNumber, {
      status: STATUS.PAID, paymentId: captured.id, updatedAt: deps.now(),
    });
    return 'restored_paid_after_race';
  }
  return row.status === STATUS.PAYMENT_PENDING ? 'marked_failed' : 'duplicate';
}
