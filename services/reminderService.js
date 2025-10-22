// services/reminderService.js
import { sendToMakeWebhook } from './makeService.js';

/**
 * checkAndSendReminders:
 * - asks Make for pending orders to notify
 * - Make returns { notify: [ { phone, message, order_id } ] }
 * - This function will return the response (Make may itself send messages or request server to send via /send-whatsapp)
 */
export async function checkAndSendReminders() {
  if (!process.env.MAKE_WEBHOOK_URL) throw new Error('MAKE_WEBHOOK_URL not configured');
  try {
    const res = await sendToMakeWebhook({ action: 'get_pending_orders' }, 'get_pending_orders');
    // res.notify expected — Make can either perform sending itself or return list for server to send.
    return res;
  } catch (err) {
    console.error('Reminder check failed', err);
    throw err;
  }
}
