import { verifyPayment } from '../lib/handlers.js';

export function POST(request) {
  return verifyPayment(request);
}
