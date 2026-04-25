import { sendToMakeWebhook, callMakeAndWait } from './makeService.js';

/**
 * Récupère la liste des promotions actives depuis Make (appel synchrone).
 * Le scénario Make "Promotions" avec action "list_promos" doit retourner :
 * un tableau [{ id, title, description, discount, validUntil }]
 */
export async function listPromotions() {
  try {
    const response = await callMakeAndWait({ action: 'list_promos' }, 'Promotions');

    if (!response) {
      console.warn('[PromoService] ⚠️ Réponse Make vide pour listPromotions');
      return [];
    }

    const promos = Array.isArray(response) ? response : response?.data || [];
    console.log(`[PromoService] ✅ ${promos.length} promotion(s) récupérée(s).`);
    return promos;
  } catch (err) {
    console.error('[PromoService] ❌ listPromotions :', err.message);
    return [];
  }
}

/**
 * Ajoute une promotion dans Google Sheets via Make (fire-and-forget).
 * @param {{ title, description, discount, validUntil }} promo
 */
export async function addPromotion(promo) {
  if (!promo?.title || !promo?.discount || !promo?.validUntil) {
    console.warn('[PromoService] ⚠️ addPromotion : données invalides.', promo);
    return false;
  }

  try {
    const payload = { action: 'add_promo', data: promo, ts: new Date().toISOString() };
    await sendToMakeWebhook(payload, 'Promotions');
    console.log(`[PromoService] ✅ Promotion "${promo.title}" ajoutée.`);
    return true;
  } catch (err) {
    console.error('[PromoService] ❌ addPromotion :', err.message);
    return false;
  }
}

/**
 * Supprime une promotion dans Google Sheets via Make (fire-and-forget).
 * @param {string|number} promoId
 */
export async function removePromotion(promoId) {
  if (!promoId) {
    console.warn('[PromoService] ⚠️ removePromotion : promoId manquant.');
    return false;
  }

  try {
    await sendToMakeWebhook({ action: 'remove_promo', data: { promoId } }, 'Promotions');
    console.log(`[PromoService] ✅ Promotion ${promoId} supprimée.`);
    return true;
  } catch (err) {
    console.error('[PromoService] ❌ removePromotion :', err.message);
    return false;
  }
}
