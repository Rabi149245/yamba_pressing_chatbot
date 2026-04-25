import { sendToMakeWebhook } from './makeService.js';
import * as notificationsService from './notificationsService.js';

/**
 * Gère une demande de ramassage à domicile (fire-and-forget vers Make).
 * Le scénario Make "Pickups" reçoit : { phone, clientName, action, ts }
 *
 * @param {string} clientPhone - Numéro WhatsApp du client
 * @param {string} clientName  - Nom du client
 * @returns {Promise<string>}  - Message de confirmation
 */
export async function handlePickupRequest(clientPhone, clientName = 'cher(e) client(e)') {
  if (!clientPhone) {
    console.warn('[PickupService] ⚠️ handlePickupRequest : numéro manquant.');
    return 'Numéro de téléphone non valide.';
  }

  const confirmationMsg =
    `👕 Bonjour ${clientName}, votre demande de *ramassage à domicile* a bien été enregistrée 🚚.\n` +
    `Notre équipe vous contactera très bientôt pour convenir du passage.\n` +
    `Merci pour votre confiance 🙏`;

  try {
    const payload = {
      phone: clientPhone,
      clientName,
      action: 'send_pickup_confirmation',
      ts: new Date().toISOString(),
    };

    await sendToMakeWebhook(payload, 'Pickups');

    // Log interne
    await notificationsService.logNotification(clientPhone, confirmationMsg, null, 'Pickup').catch(err => {
      console.warn('[PickupService] ⚠️ Log notification échoué :', err.message);
    });

    console.log(`[PickupService] ✅ Ramassage enregistré pour ${clientPhone}`);
    return confirmationMsg;
  } catch (err) {
    console.error('[PickupService] ❌ handlePickupRequest :', err.message);
    return `Désolé ${clientName}, une erreur est survenue. Veuillez réessayer.`;
  }
}
