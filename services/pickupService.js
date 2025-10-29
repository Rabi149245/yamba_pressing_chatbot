import { sendToMakeWebhook } from './makeService.js';
import * as notificationsService from './notificationsService.js';

/**
 * Gère les demandes de ramassage à domicile envoyées par les clients via WhatsApp.
 *
 * @param {string} clientPhone - Numéro du client (WhatsApp)
 * @param {string} clientName - Nom du client (si disponible)
 * @returns {Promise<string>} - Message de confirmation envoyé au client
 */
export async function handlePickupRequest(clientPhone, clientName = 'cher client') {
  if (!clientPhone) {
    console.warn('[PickupService] ⚠️ handlePickupRequest ignoré : numéro de téléphone manquant.');
    return 'Numéro de téléphone non valide.';
  }

  try {
    const confirmationMsg = `👕 Bonjour ${clientName}, votre demande de *ramassage à domicile* a bien été enregistrée. 🚚\n\nNotre livreur vous contactera très bientôt pour convenir du passage.\nMerci pour votre confiance 🙏.`;

    // 1️⃣ Envoi de la confirmation au client via Make
    const payload = {
      phone: clientPhone,
      message: confirmationMsg,
      action: 'send_pickup_confirmation',
      ts: new Date().toISOString()
    };

    const makeResponse = await sendToMakeWebhook(payload, 'send_pickup_confirmation');

    // 2️⃣ Vérification de la réponse de Make
    if (!makeResponse || (makeResponse.ok === false && makeResponse.status !== 'ok')) {
      console.warn(`[PickupService] ⚠️ Make n’a pas confirmé l’envoi du message à ${clientPhone}.`, makeResponse);
      return 'Erreur lors de l’envoi de la confirmation. Veuillez réessayer plus tard.';
    }

    // 3️⃣ Journalisation dans Google Sheets via notificationsService
    const logSuccess = await notificationsService.logNotification(clientPhone, confirmationMsg, null, 'Pickup');
    if (!logSuccess) {
      console.warn(`[PickupService] ⚠️ Impossible de journaliser la notification pour ${clientPhone}`);
    }

    console.log(`[PickupService] ✅ Ramassage confirmé pour ${clientPhone}`);
    return confirmationMsg;

  } catch (err) {
    console.error('[PickupService] ❌ Erreur lors du traitement du ramassage :', err.response?.data || err.message || err);
    return `Désolé ${clientName}, une erreur est survenue lors de votre demande de ramassage.`;
  }
}
