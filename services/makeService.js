// services/makeService.js
import axios from 'axios';
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

export async function sendToMakeWebhook(payload = {}, event = 'event') {
  if (!MAKE_WEBHOOK_URL) throw new Error('MAKE_WEBHOOK_URL not configured');
  try {
    // Return the Make response so server can act on it (e.g., get_user)
    const res = await axios.post(MAKE_WEBHOOK_URL, { event, payload, ts: new Date().toISOString() }, { timeout: 20000 });
    return res.data;
  } catch (err) {
    console.error('Make webhook error:', err.response?.data || err.message);
    // rethrow so caller knows
    throw err;
  }
}
