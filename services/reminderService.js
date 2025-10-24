// src/services/reminderService.js
import { sendToMakeWebhook } from './makeService.js';
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
    console.warn('❌ MAKE_WEBHOOK_URL non configurée — rappel annulé');
    return false;
  }

  try {
    // 1️⃣ Demande à Make la liste des commandes à rappeler
    const pending = await sendToMakeWebhook({ action: 'get_pending_orders' }, 'get_pending_orders');

    if (!pending || pending.ok === false) {
      console.warn('⚠️ Réponse Make invalide :', pending);
      return false;
    }

    const orders = Array.isArray(pending) ? pending : pending?.data || [];

    if (!orders.length) {
      console.log('✅ Aucun rappel à envoyer.');
      return true;
    }

    // 2️⃣ Envoie un message de rappel personnalisé à chaque client
    for (const order of orders) {
      const phone = order.ClientPhone;
      const name = order.ClientName || 'client(e)';
      const orderId = order.OrderId || null;

      if (!phone) {
        console.warn('⚠️ Commande sans numéro de téléphone, ignorée.');
        continue;
      }

      const msg = `Bonjour ${name}, votre vêtement est prêt 👕.\nVous pouvez passer le récupérer ou demander une livraison 🚚.\nMerci pour votre confiance ❤️.`;

      try {
        // ✅ Remplacement de sendText par sendWhatsAppMessage
        await sendWhatsAppMessage(phone, msg);
        await notificationsService.logNotification(phone, msg, orderId, 'Reminder');

        // 3️⃣ Informe Make que le rappel a été envoyé
        await sendToMakeWebhook({ action: 'mark_reminded', orderId, phone }, 'get_pending_orders');
      } catch (e) {
        console.error(`❌ Échec d’envoi du rappel à ${phone}:`, e.message);
      }
    }

    console.log(`✅ Rappels envoyés à ${orders.length} client(s).`);
    return true;

  } catch (err) {
    console.error('❌ Erreur lors de la vérification des rappels:', err.message || err);
    return false;
  }
}
