import { sendToMakeWebhook, callMakeAndWait } from './makeService.js';

/**
 * Ajoute des points de fidélité à un client (fire-and-forget).
 * Le scénario Make "PointsTransactions_add" reçoit : { clientPhone, points, reason, ts }
 */
export async function addPoints(clientPhone, points, reason = '') {
  if (!clientPhone || !points || isNaN(points) || points <= 0) {
    console.warn('[PointsService] ⚠️ addPoints : paramètres invalides', { clientPhone, points });
    return false;
  }

  try {
    const payload = {
      clientPhone,
      points: Number(points),
      reason,
      ts: new Date().toISOString(),
      action: 'add_points',
    };

    await sendToMakeWebhook(payload, 'PointsTransactions_add');
    console.log(`[PointsService] ✅ ${points} points ajoutés à ${clientPhone}`);
    return true;
  } catch (err) {
    console.error('[PointsService] ❌ addPoints :', err.message);
    return false;
  }
}

/**
 * Récupère le solde de points d'un client (appel synchrone avec réponse).
 * Le scénario Make "PointsTransactions_get" doit retourner : { points: N }
 */
export async function getPoints(clientPhone) {
  if (!clientPhone) {
    console.warn('[PointsService] ⚠️ getPoints : numéro client manquant');
    return 0;
  }

  try {
    const res = await callMakeAndWait({ clientPhone, action: 'get_points' }, 'PointsTransactions_get');

    if (!res || typeof res !== 'object') {
      console.warn('[PointsService] ⚠️ Réponse Make invalide pour getPoints', res);
      return 0;
    }

    const points = Number(res.points ?? 0);
    console.log(`[PointsService] 💰 Solde de ${clientPhone} : ${points} pts`);
    return points;
  } catch (err) {
    console.error('[PointsService] ❌ getPoints :', err.message);
    return 0;
  }
}
