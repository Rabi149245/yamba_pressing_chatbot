// src/services/pointsService.js
import { sendToMakeWebhook } from './makeService.js';

/**
 * Ajoute des points de fidélité à un client.
 * @param {string} clientPhone - Numéro du client (WhatsApp)
 * @param {number} points - Nombre de points à créditer
 * @param {string} reason - Raison facultative
 */
export async function addPoints(clientPhone, points, reason = '') {
  if (!clientPhone || !points || isNaN(points)) {
    console.warn('⚠️ addPoints appelé avec des paramètres invalides', { clientPhone, points });
    return;
  }

  try {
    const payload = {
      clientPhone,
      points,
      reason,
      ts: new Date().toISOString(),
      action: 'add_points'
    };

    const res = await sendToMakeWebhook(payload, 'PointsTransactions_add');

    if (res?.status && res.status !== 'ok') {
      console.warn('⚠️ addPoints: Make a renvoyé un statut non-ok', res);
    } else {
      console.log(`✅ ${points} points ajoutés à ${clientPhone}`);
    }
  } catch (err) {
    console.error('❌ addPoints error:', err.response?.data || err.message);
  }
}

/**
 * Récupère le solde de points d’un client depuis Make.
 * @param {string} clientPhone
 * @returns {Promise<number>} Solde de points (ou 0 en cas d'erreur)
 */
export async function getPoints(clientPhone) {
  if (!clientPhone) {
    console.warn('⚠️ getPoints appelé sans numéro de client');
    return 0;
  }

  try {
    const res = await sendToMakeWebhook({ clientPhone, action: 'get_points' }, 'PointsTransactions_get');

    // Vérifie la structure de la réponse
    if (!res || typeof res !== 'object') {
      console.warn('getPoints: réponse Make invalide', res);
      return 0;
    }

    const points = Number(res.points || 0);
    console.log(`💰 Solde de points pour ${clientPhone}: ${points}`);
    return points;
  } catch (err) {
    console.error('❌ getPoints error:', err.response?.data || err.message);
    return 0;
  }
}
