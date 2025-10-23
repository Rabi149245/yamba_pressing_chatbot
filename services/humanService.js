// src/services/humanService.js
import { sendToMakeWebhook } from './makeService.js';
import * as notificationsService from './notificationsService.js';

/**
 * Gère les cas où le client souhaite parler à un agent humain.
 * @param {string} clientPhone - Numéro du client WhatsApp
 * @param {string} clientName - Nom du client
 * @param {string} message - Message original du client
 * @returns {Promise<string>} - Message de confirmation envoyé au client
 */
export async function escalateToHuman(clientPhone, clientName = 'client', message = '') {
    try {
        const msg = `🤝 Bonjour ${clientName}, votre demande a été transmise à un agent humain 👨‍💼.\nVous serez contacté très bientôt. Merci de votre patience !`;

        // Envoie la notification à Make (pour transfert à ton équipe)
        await sendToMakeWebhook(
            {
                phone: clientPhone,
                originalMessage: message,
                action: 'escalate_to_human'
            },
            'escalate_to_human'
        );

        // Journalise l’événement
        await notificationsService.logNotification(clientPhone, msg, message, 'HumanEscalation');

        console.log(`📩 Escalade humaine envoyée pour ${clientPhone}`);
        return msg;
    } catch (err) {
        console.error('❌ Erreur lors de la redirection vers un agent humain :', err);
        throw err;
    }
}