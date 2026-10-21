import { env } from './config.js';

const API = 'https://api.razorpay.com/v1';

async function call(method, path, body) {
  const auth = Buffer.from(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`).toString('base64');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.description || res.statusText;
    throw new Error(`Razorpay ${method} ${path} failed (${res.status}): ${reason}`);
  }
  return data;
}

export function createOrder({ amount, currency, receipt, notes }) {
  return call('POST', '/orders', { amount, currency, receipt, notes });
}

export async function fetchOrderPayments(orderId) {
  const data = await call('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
  return data.items ?? [];
}
