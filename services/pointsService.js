// ✅ src/services/pointsService.js
import { sendToMakeWebhook } from './makeService.js';

/**
 * Ajoute des points de fidélité à un client.
 * @param {string} clientPhone - Numéro du client (WhatsApp)
 * @param {number} points - Nombre de points à créditer
 * @param {string} reason - Raison facultative
 */
export async function addPoints(clientPhone, points, reason = '') {
  if (!clientPhone || !points || isNaN(points)) {
    console.warn('[PointsService] ⚠️ addPoints appelé avec des paramètres invalides', { clientPhone, points });
    return;
  }

  try {
    const payload = {
      clientPhone,
      points: Number(points),
      reason,
      ts: new Date().toISOString(),
      action: 'add_points'
    };

    const res = await sendToMakeWebhook(payload, 'PointsTransactions_add');

    if (!res) {
      console.warn('[PointsService] ⚠️ Réponse Make vide pour addPoints');
      return;
    }

    if (res?.status && res.status !== 'ok') {
      console.warn('[PointsService] ⚠️ addPoints: statut non-ok reçu de Make', res);
    } else {
      console.log(`[PointsService] ✅ ${points} points ajoutés à ${clientPhone}`);
    }
  } catch (err) {
    console.error('[PointsService] ❌ Erreur addPoints :', err.response?.data || err.message);
  }
}

/**
 * Récupère le solde de points d’un client depuis Make.
 * @param {string} clientPhone - Numéro du client
 * @returns {Promise<number>} Solde de points (ou 0 en cas d'erreur)
 */
export async function getPoints(clientPhone) {
  if (!clientPhone) {
    console.warn('[PointsService] ⚠️ getPoints appelé sans numéro de client');
    return 0;
  }

  try {
    const res = await sendToMakeWebhook({ clientPhone, action: 'get_points' }, 'PointsTransactions_get');

    if (!res || typeof res !== 'object') {
      console.warn('[PointsService] ⚠️ Réponse Make invalide pour getPoints', res);
      return 0;
    }

    const points = Number(res.points ?? 0);
    console.log(`[PointsService] 💰 Solde de points pour ${clientPhone} : ${points}`);
    return points;
  } catch (err) {
    console.error('[PointsService] ❌ Erreur getPoints :', err.response?.data || err.message);
    return 0;
  }
}
