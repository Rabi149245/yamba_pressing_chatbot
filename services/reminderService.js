// src/services/reminderService.js
import { sendToMakeWebhook } from './makeService.js';
import { sendText } from './whatsappService.js';
import * as notificationsService from './notificationsService.js';

/**
 * Vérifie les commandes en attente via Make et envoie un rappel automatique.
 * 
 * Les commandes sont supposées provenir d’un scénario Make renvoyant un tableau
 * d’objets contenant au moins { ClientPhone, ClientName }.
 */
export async function checkAndSendReminders() {
  if (!process.env.MAKE_WEBHOOK_URL) {
    console.warn('❌ MAKE_WEBHOOK_URL non configurée — rappel annulé');
    return false;
  }

  try {
    // 1️⃣ Demande à Make la liste des commandes à rappeler
    const pending = await sendToMakeWebhook(
      { action: 'get_pending_orders' },
      'get_pending_orders'
    );

    if (!Array.isArray(pending) || pending.length === 0) {
      console.log('✅ Aucun rappel à envoyer.');
      return true;
    }

    // 2️⃣ Envoie un message de rappel personnalisé à chaque client
    for (const order of pending) {
      const phone = order.ClientPhone;
      const name = order.ClientName || 'client(e)';

      if (!phone) {
        console.warn('⚠️ Commande sans numéro de téléphone, ignorée.');
        continue;
      }

      const msg = `Bonjour ${name}, votre vêtement est prêt 👕.\nVous pouvez passer le récupérer ou demander une livraison 🚚.\nMerci pour votre confiance ❤️.`;

      try {
        await sendText(phone, msg);
        await notificationsService.logNotification(phone, msg, null, 'Reminder');
      } catch (e) {
        console.error(`❌ Échec d’envoi du rappel à ${phone}:`, e.message);
      }
    }

    console.log(`✅ Rappels envoyés à ${pending.length} client(s).`);
    return true;

  } catch (err) {
    console.error('❌ Erreur lors de la vérification des rappels:', err.message || err);
    return false;
  }
}
