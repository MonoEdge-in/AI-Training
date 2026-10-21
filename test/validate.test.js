import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, validateRegistration } from '../lib/validate.js';

const valid = {
  name: 'Asha Patil',
  email: 'Asha@Example.com',
  phone: '+91 98765 43210',
  company: 'Kalika Steels',
  role: 'Plant Manager',
  expectations: 'Use AI for shift reports.\nAnd for email.',
};

test('normalizePhone accepts Indian mobile formats', () => {
  for (const v of ['9876543210', '+919876543210', '+91 98765-43210', '09876543210', '919876543210', '0091 9876543210', '(987) 654 3210']) {
    assert.equal(normalizePhone(v), '9876543210', v);
  }
});

test('normalizePhone rejects non-mobiles', () => {
  for (const v of ['', '12345', '5876543210', '98765432101', '+1 9876543210', '+9198765432', 'abcdefghij', null, undefined]) {
    assert.equal(normalizePhone(v), null, String(v));
  }
});

test('valid input is cleaned and normalized', () => {
  const r = validateRegistration(valid);
  assert.equal(r.ok, true);
  assert.equal(r.data.email, 'asha@example.com');
  assert.equal(r.data.phone, '9876543210');
  assert.equal(r.data.expectations, 'Use AI for shift reports.\nAnd for email.');
});

test('missing fields are each reported', () => {
  const r = validateRegistration({});
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['company', 'email', 'expectations', 'name', 'phone', 'role']);
});

test('non-object bodies are rejected, not thrown', () => {
  for (const b of [null, undefined, 'x', 42, []]) assert.equal(validateRegistration(b).ok, false);
});

test('length limits are enforced', () => {
  assert.equal(validateRegistration({ ...valid, expectations: 'a'.repeat(1501) }).errors.expectations !== undefined, true);
  assert.equal(validateRegistration({ ...valid, expectations: 'a'.repeat(1500) }).ok, true);
  assert.equal(validateRegistration({ ...valid, name: 'a'.repeat(101) }).ok, false);
});

test('bad email is rejected', () => {
  for (const e of ['a', 'a@b', 'a b@c.com', '@c.com']) assert.equal(validateRegistration({ ...valid, email: e }).ok, false, e);
});

test('formula-looking input is kept as plain text (sheet write is RAW)', () => {
  const r = validateRegistration({ ...valid, company: '=HYPERLINK("http://x")' });
  assert.equal(r.ok, true);
  assert.equal(r.data.company, '=HYPERLINK("http://x")');
});

test('control characters are stripped', () => {
  const r = validateRegistration({ ...valid, name: 'Asha\u0000 Patil\u0007' });
  assert.equal(r.data.name, 'Asha Patil');
});
