// src/services/reminderService.js
import { sendToMakeWebhook } from './makeService.js';
import { sendText } from './whatsappService.js';
import * as notificationsService from './notificationsService.js';

export async function checkAndSendReminders() {
  if (!process.env.MAKE_WEBHOOK_URL) throw new Error('MAKE_WEBHOOK_URL not configured');

  try {
    const pending = await sendToMakeWebhook({ action: 'get_pending_orders' }, 'get_pending_orders');

    if (!Array.isArray(pending)) return true;

    for (const order of pending) {
      const phone = order.ClientPhone;
      const name = order.ClientName || '';
      const msg = `Bonjour ${name}, votre vêtement est prêt 👕. Vous pouvez le récupérer ou demander une livraison 🚚.`;
      try {
        await sendText(phone, msg);
      } catch (e) {
        console.warn('Reminder: sendText failed', e.message);
      }
      await notificationsService.logNotification(phone, msg, null, 'Reminder');
    }
    return true;
  } catch (err) {
    console.error('Reminder check failed', err);
    throw err;
  }
}
