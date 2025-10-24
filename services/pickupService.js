// src/services/pickupService.js
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
    console.warn('⚠️ handlePickupRequest ignoré : numéro de téléphone manquant.');
    return 'Numéro de téléphone non valide.';
  }

  try {
    const msg = `👕 Bonjour ${clientName}, votre demande de *ramassage à domicile* a bien été enregistrée. 🚚\n\nNotre livreur vous contactera très bientôt pour convenir du passage.\nMerci pour votre confiance 🙏.`;

    // 1️⃣ Envoie la confirmation au client via Make
    const response = await sendToMakeWebhook(
      { phone: clientPhone, message: msg },
      'send_pickup_confirmation'
    );

    if (response?.ok === false) {
      console.warn(`⚠️ Make n’a pas confirmé l’envoi du message à ${clientPhone}.`);
    }

    // 2️⃣ Journalise la notification localement et dans Make
    await notificationsService.logNotification(clientPhone, msg, null, 'Pickup');

    console.log(`✅ Ramassage confirmé pour ${clientPhone}`);
    return msg;

  } catch (err) {
    console.error('❌ Erreur lors du traitement du ramassage :', err.message || err);
    return `Désolé ${clientName}, une erreur est survenue lors de votre demande de ramassage.`;
  }
}
