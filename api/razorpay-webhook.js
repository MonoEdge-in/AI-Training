import { razorpayWebhook } from '../lib/handlers.js';

export function POST(request) {
  return razorpayWebhook(request);
}
