// services/makeService.js
import axios from 'axios';
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

/**
 * sendToMakeWebhook(payload, event)
 * - payload: object (content)
 * - event: string (action/event identifier)
 *
 * Expects Make to return JSON in res.data. The function rethrows on network/HTTP error.
 */
export async function sendToMakeWebhook(payload = {}, event = 'event') {
  if (!MAKE_WEBHOOK_URL) throw new Error('MAKE_WEBHOOK_URL not configured');
  try {
    const res = await axios.post(MAKE_WEBHOOK_URL, { event, payload, ts: new Date().toISOString() }, { timeout: 20000 });
    // Make must return JSON object describing result for the event
    return res.data;
  } catch (err) {
    console.error('Make webhook error:', err.response?.data || err.message);
    throw err;
  }
}
