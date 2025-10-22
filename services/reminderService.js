import { sendToMakeWebhook } from './makeService.js';
import { sendText } from './whatsappService.js';
import * as notificationsService from './notificationsService.js';

export async function checkAndSendReminders() {
    if (!process.env.MAKE_WEBHOOK_URL) throw new Error('MAKE_WEBHOOK_URL not configured');

    try {
        const pending = await sendToMakeWebhook({ action: 'get_pending_orders' }, 'get_pending_orders');

        for (const order of pending) {
            const msg = `Bonjour ${order.ClientName || ''}, votre vêtement est prêt 👕. Vous pouvez le récupérer ou demander une livraison 🚚.`;
            
            // Envoi direct WhatsApp
            await sendText(order.ClientPhone, msg);

            // Logging
            await notificationsService.logNotification(order.ClientPhone, msg, null, 'Reminder');
        }

        return true;
    } catch (err) {
        console.error('Reminder check failed', err);
        throw err;
    }
}
