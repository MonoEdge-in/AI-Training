import { createOrder } from '../lib/handlers.js';

export function POST(request) {
  return createOrder(request);
}
