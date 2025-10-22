// services/reminderService.js
import { sendToMakeWebhook } from './makeService.js';

/**
 * checkAndSendReminders:
 * - asks Make for pending orders (get_pending_orders)
 * - Make should return list of orders to notify (phone, message or template)
 * - This function only forwards the request and logs result
 */
export async function checkAndSendReminders() {
  if (!process.env.MAKE_WEBHOOK_URL) throw new Error('MAKE_WEBHOOK_URL not configured');
  try {
    const res = await sendToMakeWebhook({ action: 'get_pending_orders' }, 'get_pending_orders');
    // res expected: { notify: [ { phone, message, type } ] }
    if (res && res.notify && Array.isArray(res.notify)) {
      console.log('Reminders to send:', res.notify.length);
      // Ideally Make will call your /send-whatsapp endpoint or call directly WhatsApp
      // We just return res so admin/Make can act.
    }
    return res;
  } catch (err) {
    console.error('Reminder check failed', err);
    throw err;
  }
}
