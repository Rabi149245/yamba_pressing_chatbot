import { sendToMakeWebhook, queryMakeWebhook } from './makeService.js';
import { sendWhatsAppMessage } from './whatsappService.js';
import * as notificationsService from './notificationsService.js';

/**
 * Vérifie les commandes en attente via Make et envoie un rappel automatique.
 *
 * Les commandes doivent provenir d’un scénario Make renvoyant un tableau
 * d’objets contenant au moins { ClientPhone, ClientName, OrderId }.
 */
export async function checkAndSendReminders() {
  if (!process.env.MAKE_WEBHOOK_URL) {
    console.warn('[ReminderService] ⚠️ MAKE_WEBHOOK_URL non configurée — rappel annulé');
    return false;
  }

  try {
    // 1️⃣ Demande synchrone à Make la liste des commandes à rappeler
    const pending = await queryMakeWebhook({ action: 'get_pending_orders' }, 'get_pending_orders');

    // Vérification de la réponse de Make
    if (!pending || (pending.ok === false && !Array.isArray(pending))) {
      console.warn('[ReminderService] ⚠️ Réponse Make invalide ou vide :', pending);
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

    // 2️⃣ Envoie un message de rappel personnalisé à chaque client
    for (const order of orders) {
      const phone = order.ClientPhone;
      const name = order.ClientName || 'client(e)';
      const orderId = order.OrderId || null;

      if (!phone) {
        console.warn('[ReminderService] ⚠️ Commande sans numéro de téléphone, ignorée.', order);
        continue;
      }

      const msg = `Bonjour ${name}, votre vêtement est prêt 👕.\nVous pouvez passer le récupérer ou demander une livraison 🚚.\nMerci pour votre confiance ❤️.`;

      try {
        await sendWhatsAppMessage(phone, msg);
        await notificationsService.logNotification(phone, msg, orderId, 'Reminder');

        // 3️⃣ Informe Make que le rappel a été envoyé
        await sendToMakeWebhook({ action: 'mark_reminded', orderId, phone }, 'order_mark_reminded');

        console.log(`[ReminderService] ✅ Rappel envoyé à ${phone}`);
      } catch (e) {
        console.error(`[ReminderService] ❌ Échec d’envoi du rappel à ${phone}:`, e.message || e);
      }
    }

    console.log(`[ReminderService] ✅ Rappels envoyés à ${orders.length} client(s).`);
    return true;

  } catch (err) {
    console.error('[ReminderService] ❌ Erreur lors de la vérification des rappels :', err.message || err);
    return false;
  }
}
