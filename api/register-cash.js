import { registerCash } from '../lib/handlers.js';

export function POST(request) {
  return registerCash(request);
}
