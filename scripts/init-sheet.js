// Usage: node --env-file=.env scripts/init-sheet.js
// Needs GOOGLE_SERVICE_ACCOUNT_KEY_B64 and GOOGLE_SHEET_ID.
import { initSheet } from '../lib/sheets.js';

try {
  console.log(await initSheet());
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
