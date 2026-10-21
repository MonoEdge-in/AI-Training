import { JWT } from 'google-auth-library';
import { env, SHEET_TAB } from './config.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column order of the Registrations tab. Index = position in the row.
export const COLUMNS = [
  'createdAt', 'registrationId', 'status', 'paymentMethod', 'name', 'email', 'phone',
  'company', 'role', 'expectations', 'amountInr', 'orderId', 'paymentId', 'updatedAt',
];
export const HEADERS = [
  'Created At (IST)', 'Registration ID', 'Status', 'Payment Method', 'Name', 'Email', 'Phone',
  'Company', 'Role', 'Expectations', 'Amount (INR)', 'Razorpay Order ID', 'Razorpay Payment ID',
  'Updated At (IST)',
];
const col = (key) =>String.fromCharCode(65 + COLUMNS.indexOf(key));

let client;
function auth() {
  if (!client) {
    const key = JSON.parse(Buffer.from(env('GOOGLE_SERVICE_ACCOUNT_KEY_B64'), 'base64').toString('utf8'));
    client = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return client;
}

async function request(method, path, data) {
  const res = await auth().request({
    url: `${API}/${env('GOOGLE_SHEET_ID')}${path}`,
    method,
    data,
    timeout: 8000,
  });
  return res.data;
}

const range = (a1) => encodeURIComponent(`${SHEET_TAB}!${a1}`);

export async function appendRow(record) {
  const row = COLUMNS.map((key) => record[key] ?? '');
  // RAW: user input is stored literally, never parsed as a formula, number or date.
  await request(
    'POST',
    `/values/${range('A:N')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [row] },
  );
}

export async function registrationIdExists(id) {
  const data = await request('GET', `/values/${range('B2:B')}`);
  return (data.values ?? []).some((r) => r[0] === id);
}

// Returns { rowNumber, status, paymentId } for the row holding this order, or null.
export async function findByOrderId(orderId) {
  const data = await request('GET', `/values/${range('A2:N')}`);
  const rows = data.values ?? [];
  const iOrder = COLUMNS.indexOf('orderId');
  const index = rows.findIndex((r) => r[iOrder] === orderId);
  if (index === -1) return null;
  const r = rows[index];
  return {
    rowNumber: index + 2,
    status: r[COLUMNS.indexOf('status')] ?? '',
    paymentId: r[COLUMNS.indexOf('paymentId')] ?? '',
  };
}

// One-time setup: creates the tab and header row if missing. Never overwrites a different header.
export async function initSheet() {
  const meta = await request('GET', '?fields=sheets.properties.title');
  const exists = (meta.sheets ?? []).some((s) => s.properties.title === SHEET_TAB);
  if (!exists) {
    await request('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] });
  }
  const current = (await request('GET', `/values/${range('A1:N1')}`)).values?.[0] ?? [];
  if (current.length === 0) {
    await request('PUT', `/values/${range('A1:N1')}?valueInputOption=RAW`, { values: [HEADERS] });
    return `${exists ? 'Wrote header to' : 'Created'} tab ${SHEET_TAB}.`;
  }
  if (current.join('|') !== HEADERS.join('|')) {
    throw new Error(`Tab ${SHEET_TAB} has a different header row:\n${current.join(' | ')}`);
  }
  return `Tab ${SHEET_TAB} already has the correct header.`;
}

export async function updatePaymentStatus(rowNumber, { status, paymentId, updatedAt }) {
  await request('POST', '/values:batchUpdate', {
    valueInputOption: 'RAW',
    data: [
      { range: `${SHEET_TAB}!${col('status')}${rowNumber}`, values: [[status]] },
      { range: `${SHEET_TAB}!${col('paymentId')}${rowNumber}`, values: [[paymentId]] },
      { range: `${SHEET_TAB}!${col('updatedAt')}${rowNumber}`, values: [[updatedAt]] },
    ],
  });
}
