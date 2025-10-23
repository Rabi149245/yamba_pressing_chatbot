// src/services/pickupService.js
import { sendToMakeWebhook } from './makeService.js';
import * as notificationsService from './notificationsService.js';

/**
 * Gère les demandes de ramassage à domicile envoyées par les clients via WhatsApp.
 * @param {string} clientPhone - Numéro du client (WhatsApp)
 * @param {string} clientName - Nom du client (si disponible)
 * @returns {Promise<string>} - Message de confirmation envoyé au client
 */
export async function handlePickupRequest(clientPhone, clientName = 'cher client') {
    try {
        const msg = `👕 Bonjour ${clientName}, votre demande de *ramassage à domicile* a bien été enregistrée. 🚚\n\nNotre livreur vous contactera très bientôt pour convenir du passage.\nMerci pour votre confiance 🙏.`;

        // Envoie le message via Make
        await sendToMakeWebhook(
            { phone: clientPhone, message: msg },
            'send_pickup_confirmation'
        );

        // Journalise la notification
        await notificationsService.logNotification(clientPhone, msg, null, 'Pickup');

        console.log(`✅ Pickup confirmé pour ${clientPhone}`);
        return msg;
    } catch (err) {
        console.error('❌ Erreur lors du traitement du ramassage :', err);
        throw err;
    }
}