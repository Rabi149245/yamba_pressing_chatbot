import { callMakeAndWait, sendToMakeWebhook } from './makeService.js';
import { sendWhatsAppMessage } from './whatsappService.js';
import * as notificationsService from './notificationsService.js';

/**
 * Vérifie les commandes en attente et envoie les rappels WhatsApp.
 *
 * Le scénario Make "get_pending_orders" doit retourner :
 * [{ ClientPhone, ClientName, OrderId }]
 *
 * Le scénario Make "order_mark_reminded" reçoit :
 * { action: 'mark_reminded', orderId, phone }
 */
export async function checkAndSendReminders() {
  if (!process.env.MAKE_WEBHOOK_URL) {
    console.warn('[ReminderService] ⚠️ MAKE_WEBHOOK_URL manquante — rappel annulé');
    return false;
  }

  try {
    // Appel synchrone : on a besoin de la liste des commandes
    const pending = await callMakeAndWait({ action: 'get_pending_orders' }, 'get_pending_orders');

    if (!pending) {
      console.warn('[ReminderService] ⚠️ Réponse Make vide ou invalide');
      return false;
    }

    const orders = Array.isArray(pending)
      ? pending
      : Array.isArray(pending.data)
      ? pending.data
      : [];

    if (!orders.length) {
      console.log('[ReminderService] ✅ Aucun rappel à envoyer.');
      return true;
    }

    for (const order of orders) {
      const phone   = order.ClientPhone;
      const name    = order.ClientName || 'client(e)';
      const orderId = order.OrderId || null;

      if (!phone) {
        console.warn('[ReminderService] ⚠️ Commande sans numéro — ignorée.', order);
        continue;
      }

      const msg =
        `👕 Bonjour ${name}, vos vêtements sont prêts !\n` +
        `Vous pouvez passer les récupérer au pressing ou demander une livraison 🚚.\n` +
        `Merci pour votre confiance ❤️`;

      try {
        await sendWhatsAppMessage(phone, msg);
        await notificationsService.logNotification(phone, msg, null, 'Reminder');
        // Marquer comme rappelé dans Google Sheets
        await sendToMakeWebhook({ action: 'mark_reminded', orderId, phone }, 'order_mark_reminded');
        console.log(`[ReminderService] ✅ Rappel envoyé à ${phone}`);
      } catch (e) {
        console.error(`[ReminderService] ❌ Erreur rappel pour ${phone}:`, e.message);
      }
    }

    console.log(`[ReminderService] ✅ ${orders.length} rappel(s) traité(s).`);
    return true;
  } catch (err) {
    console.error('[ReminderService] ❌ checkAndSendReminders :', err.message);
    return false;
  }
}
