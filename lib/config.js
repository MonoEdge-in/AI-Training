// Fixed workshop facts. The fee lives here and only here: the browser never sends an amount.
export const AMOUNT_PAISE = 349900;
export const AMOUNT_INR = 3499;
export const CURRENCY = 'INR';
export const SHEET_TAB = 'Registrations';

export const STATUS = Object.freeze({
  PAYMENT_PENDING: 'payment_pending',
  PAID: 'paid',
  PAYMENT_FAILED: 'payment_failed',
  CASH_PENDING: 'cash_pending',
  CASH_RECEIVED: 'cash_received',
});

const REQUIRED_ENV = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'GOOGLE_SERVICE_ACCOUNT_KEY_B64',
  'GOOGLE_SHEET_ID',
];

export function env(name) {
  if (!REQUIRED_ENV.includes(name)) throw new Error(`Unknown env var ${name}`);
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
