// Shared by the browser (imported from /lib/validate.js) and the API.
// The API result is authoritative; the browser copy only gives early feedback.

export const LIMITS = Object.freeze({
  name: 100,
  email: 254,
  company: 150,
  role: 100,
  expectations: 1500,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Drop control characters except newline and tab (newlines are kept in expectations only).
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanLine(value) {
  return String(value ?? '').replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim();
}

function cleanText(value) {
  return String(value ?? '').replace(CONTROL_RE, '').replace(/\r\n?/g, '\n').trim();
}

// Accepts 9876543210, +91 98765 43210, 091-9876543210, 919876543210.
// Returns the 10-digit Indian mobile number, or null.
export function normalizePhone(value) {
  let digits = String(value ?? '').replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('0091')) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

// Returns { ok: true, data } or { ok: false, errors: { field: message } }.
export function validateRegistration(input) {
  const src = input && typeof input === 'object' ? input : {};
  const errors = {};

  const name = cleanLine(src.name);
  if (name.length < 2) errors.name = 'Enter your full name.';
  else if (name.length > LIMITS.name) errors.name = `Keep your name under ${LIMITS.name} characters.`;

  const email = cleanLine(src.email).toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > LIMITS.email) errors.email = 'Enter a valid email address.';

  const phone = normalizePhone(src.phone);
  if (!phone) errors.phone = 'Enter a 10-digit Indian mobile number.';

  const company = cleanLine(src.company);
  if (!company) errors.company = 'Enter your company.';
  else if (company.length > LIMITS.company) errors.company = `Keep this under ${LIMITS.company} characters.`;

  const role = cleanLine(src.role);
  if (!role) errors.role = 'Enter your role.';
  else if (role.length > LIMITS.role) errors.role = `Keep this under ${LIMITS.role} characters.`;

  const expectations = cleanText(src.expectations);
  if (!expectations) errors.expectations = 'Tell us what you expect from the workshop.';
  else if (expectations.length > LIMITS.expectations) {
    errors.expectations = `Keep this under ${LIMITS.expectations} characters.`;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { name, email, phone, company, role, expectations } };
}
