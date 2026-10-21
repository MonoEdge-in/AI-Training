import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createOrder, razorpayWebhook, registerCash, verifyPayment } from '../lib/handlers.js';
import { nowIST } from '../lib/util.js';

const SECRETS = {
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'key_secret',
  RAZORPAY_WEBHOOK_SECRET: 'webhook_secret',
};

const validBody = {
  name: 'Asha Patil', email: 'asha@example.com', phone: '09876543210',
  company: 'Kalika Steels', role: 'Plant Manager', expectations: 'Learn AI.',
};

// In-memory stand-ins for the sheet and the Razorpay API.
function fakes({ orderPayments = [] } = {}) {
  const rows = [];
  const calls = { createOrder: [], updates: [] };
  let ids = 0;
  const deps = {
    env: (k) => SECRETS[k],
    now: () => '2026-11-01 10:00:00',
    newId: () => `AIW-TEST${String(++ids).padStart(2, '0')}`,
    log: { info() {}, warn() {}, error() {} },
    razorpay: {
      async createOrder(args) {
        calls.createOrder.push(args);
        return { id: `order_${calls.createOrder.length}`, amount: args.amount, currency: args.currency };
      },
      async fetchOrderPayments() { return orderPayments; },
    },
    sheets: {
      async appendRow(r) { rows.push({ ...r }); },
      async registrationIdExists(id) { return rows.some((r) => r.registrationId === id); },
      async findByOrderId(orderId) {
        const i = rows.findIndex((r) => r.orderId === orderId);
        return i === -1 ? null : { rowNumber: i + 2, status: rows[i].status, paymentId: rows[i].paymentId };
      },
      async updatePaymentStatus(rowNumber, u) {
        calls.updates.push({ rowNumber, ...u });
        Object.assign(rows[rowNumber - 2], u);
      },
    },
  };
  return { deps, rows, calls };
}

const req = (body, headers = {}) => new Request('http://x/api', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

function webhookReq(event, { secret = SECRETS.RAZORPAY_WEBHOOK_SECRET, tamper = false } = {}) {
  const raw = JSON.stringify(event);
  const sig = createHmac('sha256', secret).update(raw).digest('hex');
  const body = tamper ? raw.replace('349900', '100') : raw;
  return req(body, { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_1' });
}

const paymentEvent = (type, { orderId = 'order_1', paymentId = 'pay_A', amount = 349900 } = {}) => ({
  entity: 'event', event: type, contains: ['payment'],
  payload: { payment: { entity: {
    id: paymentId, order_id: orderId, amount, currency: 'INR',
    status: type === 'payment.captured' ? 'captured' : 'failed',
  } } },
});

async function registeredOnline(opts) {
  const f = fakes(opts);
  const res = await createOrder(req(validBody), f.deps);
  assert.equal(res.status, 200);
  return f;
}

// ---- create-order ----

test('create-order: uses the server amount, ignores any amount from the browser', async () => {
  const f = fakes();
  const res = await createOrder(req({ ...validBody, amount: 1, paymentMethod: 'online' }), f.deps);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(f.calls.createOrder[0].amount, 349900);
  assert.equal(f.calls.createOrder[0].currency, 'INR');
  assert.equal(f.calls.createOrder[0].receipt, data.registrationId);
  assert.equal(data.amount, 349900);
  assert.equal(data.keyId, 'rzp_test_key');
  assert.deepEqual(data.prefill, { name: 'Asha Patil', email: 'asha@example.com', contact: '+919876543210' });
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].status, 'payment_pending');
  assert.equal(f.rows[0].paymentMethod, 'online');
  assert.equal(f.rows[0].phone, '9876543210');
  assert.equal(f.rows[0].amountInr, 3499);
  assert.equal(f.rows[0].orderId, 'order_1');
});

test('create-order: invalid input returns 400 with field errors and writes nothing', async () => {
  const f = fakes();
  const res = await createOrder(req({ ...validBody, phone: '123' }), f.deps);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).errors.phone);
  assert.equal(f.calls.createOrder.length, 0);
  assert.equal(f.rows.length, 0);
});

test('create-order: malformed JSON returns 400', async () => {
  const f = fakes();
  assert.equal((await createOrder(req('{nope'), f.deps)).status, 400);
});

test('create-order: Razorpay failure returns 500 and writes no row', async () => {
  const f = fakes();
  f.deps.razorpay.createOrder = async () => { throw new Error('down'); };
  const res = await createOrder(req(validBody), f.deps);
  assert.equal(res.status, 500);
  assert.equal(f.rows.length, 0);
});

test('create-order: regenerates a colliding registration ID', async () => {
  const f = fakes();
  const seq = ['AIW-AAAAAA', 'AIW-AAAAAA', 'AIW-BBBBBB'];
  f.deps.newId = () => seq.shift();
  await registerCash(req(validBody), f.deps);
  await registerCash(req(validBody), f.deps);
  assert.deepEqual(f.rows.map((r) => r.registrationId), ['AIW-AAAAAA', 'AIW-BBBBBB']);
});

// ---- cash ----

test('register-cash: writes a cash_pending row with no order', async () => {
  const f = fakes();
  const res = await registerCash(req({ ...validBody, paymentMethod: 'cash' }), f.deps);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.match(data.registrationId, /^AIW-/);
  assert.equal(f.rows[0].status, 'cash_pending');
  assert.equal(f.rows[0].paymentMethod, 'cash');
  assert.equal(f.rows[0].orderId, '');
  assert.equal(f.calls.createOrder.length, 0);
});

test('register-cash: duplicates are allowed', async () => {
  const f = fakes();
  await registerCash(req(validBody), f.deps);
  await registerCash(req(validBody), f.deps);
  assert.equal(f.rows.length, 2);
});

// ---- verify-payment ----

test('verify-payment: accepts a correct signature and writes nothing', async () => {
  const f = await registeredOnline();
  const sig = createHmac('sha256', SECRETS.RAZORPAY_KEY_SECRET).update('order_1|pay_A').digest('hex');
  const res = await verifyPayment(req({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_A', razorpay_signature: sig }), f.deps);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  assert.equal(f.calls.updates.length, 0);
  assert.equal(f.rows[0].status, 'payment_pending');
});

test('verify-payment: rejects a tampered or malformed signature', async () => {
  const f = fakes();
  const sig = createHmac('sha256', SECRETS.RAZORPAY_KEY_SECRET).update('order_1|pay_A').digest('hex');
  for (const body of [
    { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_B', razorpay_signature: sig },
    { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_A', razorpay_signature: sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0') },
    { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_A', razorpay_signature: 'short' },
    { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_A' },
    {},
  ]) {
    const res = await verifyPayment(req(body), f.deps);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

// ---- webhook ----

test('webhook: payment.captured marks pending row paid with payment id', async () => {
  const f = await registeredOnline();
  const res = await razorpayWebhook(webhookReq(paymentEvent('payment.captured')), f.deps);
  assert.equal(res.status, 200);
  assert.equal(f.rows[0].status, 'paid');
  assert.equal(f.rows[0].paymentId, 'pay_A');
  assert.equal(f.rows[0].updatedAt, '2026-11-01 10:00:00');
});

test('webhook: duplicate captured delivery is a no-op', async () => {
  const f = await registeredOnline();
  await razorpayWebhook(webhookReq(paymentEvent('payment.captured')), f.deps);
  const res = await razorpayWebhook(webhookReq(paymentEvent('payment.captured')), f.deps);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).outcome, 'duplicate');
  assert.equal(f.calls.updates.length, 1);
});

test('webhook: failed then retry captured ends paid', async () => {
  const f = await registeredOnline();
  await razorpayWebhook(webhookReq(paymentEvent('payment.failed', { paymentId: 'pay_F' })), f.deps);
  assert.equal(f.rows[0].status, 'payment_failed');
  assert.equal(f.rows[0].paymentId, 'pay_F');
  await razorpayWebhook(webhookReq(paymentEvent('payment.captured', { paymentId: 'pay_OK' })), f.deps);
  assert.equal(f.rows[0].status, 'paid');
  assert.equal(f.rows[0].paymentId, 'pay_OK');
});

test('webhook: late failed event never overwrites paid', async () => {
  const f = await registeredOnline();
  await razorpayWebhook(webhookReq(paymentEvent('payment.captured', { paymentId: 'pay_OK' })), f.deps);
  const res = await razorpayWebhook(webhookReq(paymentEvent('payment.failed', { paymentId: 'pay_F' })), f.deps);
  assert.equal(res.status, 200);
  assert.equal(f.rows[0].status, 'paid');
  assert.equal(f.rows[0].paymentId, 'pay_OK');
});

test('webhook: failed racing a capture restores paid from Razorpay', async () => {
  // Razorpay already holds a captured payment for this order, but the sheet still
  // read pending when the failed event was processed.
  const f = await registeredOnline({ orderPayments: [{ id: 'pay_F', status: 'failed' }, { id: 'pay_OK', status: 'captured' }] });
  const res = await razorpayWebhook(webhookReq(paymentEvent('payment.failed', { paymentId: 'pay_F' })), f.deps);
  assert.equal((await res.json()).outcome, 'restored_paid_after_race');
  assert.equal(f.rows[0].status, 'paid');
  assert.equal(f.rows[0].paymentId, 'pay_OK');
});

test('webhook: redelivered failed after an errored attempt still runs the Razorpay check', async () => {
  const f = await registeredOnline();
  f.deps.razorpay.fetchOrderPayments = async () => { throw new Error('timeout'); };
  const first = await razorpayWebhook(webhookReq(paymentEvent('payment.failed', { paymentId: 'pay_F' })), f.deps);
  assert.equal(first.status, 500);
  assert.equal(f.rows[0].status, 'payment_failed');
  f.deps.razorpay.fetchOrderPayments = async () => [{ id: 'pay_OK', status: 'captured' }];
  const second = await razorpayWebhook(webhookReq(paymentEvent('payment.failed', { paymentId: 'pay_F' })), f.deps);
  assert.equal(second.status, 200);
  assert.equal(f.rows[0].status, 'paid');
});

test('webhook: tampered body is rejected with 400 and nothing written', async () => {
  const f = await registeredOnline();
  const res = await razorpayWebhook(webhookReq(paymentEvent('payment.captured'), { tamper: true }), f.deps);
  assert.equal(res.status, 400);
  assert.equal(f.rows[0].status, 'payment_pending');
});

test('webhook: wrong secret or missing signature is rejected', async () => {
  const f = await registeredOnline();
  assert.equal((await razorpayWebhook(webhookReq(paymentEvent('payment.captured'), { secret: 'other' }), f.deps)).status, 400);
  assert.equal((await razorpayWebhook(req(paymentEvent('payment.captured')), f.deps)).status, 400);
  assert.equal(f.calls.updates.length, 0);
});

test('webhook: signature is checked on raw bytes, not re-serialized JSON', async () => {
  const f = await registeredOnline();
  // Same JSON value, different whitespace: a JSON.stringify-based check would fail this.
  const raw = JSON.stringify(paymentEvent('payment.captured'), null, 2);
  const sig = createHmac('sha256', SECRETS.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  const res = await razorpayWebhook(req(raw, { 'x-razorpay-signature': sig }), f.deps);
  assert.equal(res.status, 200);
  assert.equal(f.rows[0].status, 'paid');
});

test('webhook: unknown order and other events return 200 without writes', async () => {
  const f = await registeredOnline();
  const unknown = await razorpayWebhook(webhookReq(paymentEvent('payment.captured', { orderId: 'order_other' })), f.deps);
  assert.equal(unknown.status, 200);
  assert.equal((await unknown.json()).outcome, 'unknown_order');
  const other = await razorpayWebhook(webhookReq({ event: 'order.paid', payload: {} }), f.deps);
  assert.equal(other.status, 200);
  assert.equal(f.calls.updates.length, 0);
});

test('webhook: captured with unexpected amount is not recorded as paid', async () => {
  const f = await registeredOnline();
  const res = await razorpayWebhook(webhookReq(paymentEvent('payment.captured', { amount: 100 })), f.deps);
  assert.equal(res.status, 200);
  assert.equal(f.rows[0].status, 'payment_pending');
});

test('webhook: sheet outage returns 500 so Razorpay redelivers', async () => {
  const f = await registeredOnline();
  f.deps.sheets.findByOrderId = async () => { throw new Error('sheets down'); };
  const res = await razorpayWebhook(webhookReq(paymentEvent('payment.captured')), f.deps);
  assert.equal(res.status, 500);
});

test('webhook: cash rows are never touched', async () => {
  const f = fakes();
  await registerCash(req(validBody), f.deps);
  f.rows[0].orderId = 'order_x'; // even if an order id somehow matched
  const res = await razorpayWebhook(webhookReq(paymentEvent('payment.captured', { orderId: 'order_x' })), f.deps);
  assert.equal(res.status, 200);
  assert.equal(f.rows[0].status, 'cash_pending');
});

test('nowIST formats in Asia/Kolkata', () => {
  assert.equal(nowIST(new Date('2026-11-20T20:00:05Z')), '2026-11-21 01:30:05');
});
