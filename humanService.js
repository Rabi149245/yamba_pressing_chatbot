import { sendToMakeWebhook } from './makeService.js';
import * as notificationsService from './notificationsService.js';

/**
 * Escalade vers un agent humain.
 * Envoie une notification à Make (fire-and-forget) + log local.
 *
 * @param {string} clientPhone  - Numéro WhatsApp du client
 * @param {string} clientName   - Nom du client (optionnel)
 * @param {string} message      - Message original du client
 * @returns {Promise<string>}   - Message de confirmation pour le client
 */
export async function escalateToHuman(clientPhone, clientName = 'client(e)', message = '') {
  if (!clientPhone) {
    console.warn('[HumanService] ⚠️ escalateToHuman : numéro manquant');
    return 'Erreur interne : numéro de téléphone manquant.';
  }

  const confirmationMsg =
    `🤝 Bonjour ${clientName}, votre demande a bien été transmise à un agent 👨‍💼.\n` +
    `Vous serez contacté(e) très bientôt. Merci pour votre patience !`;

  try {
    const payload = {
      phone: clientPhone,
      clientName,
      originalMessage: message,
      action: 'escalate_to_human',
      ts: new Date().toISOString(),
    };

    // Fire-and-forget : Make reçoit la demande et notifie l'équipe
    await sendToMakeWebhook(payload, 'escalate_to_human');
    console.log(`[HumanService] ✅ Escalade enregistrée pour ${clientPhone}`);

    // Log interne de la notification
    try {
      await notificationsService.logNotification(clientPhone, confirmationMsg, null, 'HumanEscalation');
    } catch (err) {
      console.warn('[HumanService] ⚠️ Erreur log notification :', err.message);
    }

    return confirmationMsg;
  } catch (err) {
    console.error('[HumanService] ❌ escalateToHuman :', err.message);
    return `Désolé ${clientName}, une erreur est survenue. Veuillez réessayer.`;
  }
}
