// src/services/humanService.js
import { sendToMakeWebhook } from './makeService.js';
import * as notificationsService from './notificationsService.js';

/**
 * Escalade vers un agent humain lorsque le client le demande.
 * @param {string} clientPhone - Numéro du client WhatsApp
 * @param {string} clientName - Nom du client
 * @param {string} message - Message original du client
 * @returns {Promise<string>} - Message de confirmation envoyé au client
 */
export async function escalateToHuman(clientPhone, clientName = 'client(e)', message = '') {
  if (!process.env.MAKE_WEBHOOK_URL) {
    console.warn('❌ MAKE_WEBHOOK_URL non configurée — escalade annulée');
    return 'Erreur interne : service indisponible.';
  }

  try {
    // 1️⃣ Message de confirmation pour le client
    const confirmationMsg = `🤝 Bonjour ${clientName}, votre demande a été transmise à un agent humain 👨‍💼.\nVous serez contacté très bientôt. Merci pour votre patience !`;

    // 2️⃣ Envoi de la notification à Make (signalement à ton équipe)
    const payload = {
      phone: clientPhone,
      originalMessage: message,
      action: 'escalate_to_human',
      ts: new Date().toISOString()
    };

    const makeResponse = await sendToMakeWebhook(payload, 'escalate_to_human');

    if (makeResponse?.status === 'ok' || makeResponse?.success) {
      console.log(`📩 Escalade humaine réussie pour ${clientPhone}`);
    } else {
      console.warn('⚠️ Réponse inattendue de Make pour escalate_to_human:', makeResponse);
    }

    // 3️⃣ Journalisation locale / notification interne
    await notificationsService.logNotification(clientPhone, confirmationMsg, message, 'HumanEscalation');

    return confirmationMsg;
  } catch (err) {
    console.error('❌ Erreur lors de la redirection vers un agent humain :', err.message || err);
    throw err;
  }
}
