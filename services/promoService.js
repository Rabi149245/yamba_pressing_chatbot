import { sendToMakeWebhook } from './makeService.js';

/**
 * Récupère la liste des promotions depuis Google Sheets via Make.
 * 
 * Le scénario Make "Promotions" doit renvoyer un tableau JSON d'objets
 * contenant au minimum { id, title, description, discount, validUntil }.
 */
export async function listPromotions() {
  try {
    const response = await sendToMakeWebhook({ action: 'list_promos' }, 'Promotions');

    if (!response || response.ok === false) {
      console.warn('[PromoService] ⚠️ Réponse Make invalide pour listPromotions :', response);
      return [];
    }

    const promos = Array.isArray(response) ? response : response?.data || [];
    console.log(`[PromoService] ✅ ${promos.length} promotion(s) récupérée(s).`);
    return promos;

  } catch (err) {
    console.error('[PromoService] ❌ Erreur lors de listPromotions :', err.message || err);
    return [];
  }
}

/**
 * Ajoute une promotion dans Google Sheets via Make.
 * 
 * @param {Object} promo - Détails de la promotion
 * @param {string} promo.title - Titre de la promotion
 * @param {string} promo.description - Description
 * @param {number} promo.discount - Pourcentage de réduction
 * @param {string} promo.validUntil - Date de fin de validité (YYYY-MM-DD)
 * @returns {Promise<boolean>}
 */
export async function addPromotion(promo) {
  if (!promo || !promo.title || !promo.discount || !promo.validUntil) {
    console.warn('[PromoService] ⚠️ addPromotion ignoré : données invalides.');
    return false;
  }

  try {
    const payload = { action: 'add_promo', data: promo, ts: new Date().toISOString() };
    const res = await sendToMakeWebhook(payload, 'Promotions');

    // Vérification de la réponse de Make
    if (res?.ok === false) {
      console.warn('[PromoService] ⚠️ Make a retourné une erreur lors de addPromotion :', res);
      return false;
    }

    console.log(`[PromoService] ✅ Promotion "${promo.title}" ajoutée avec succès.`);
    return true;

  } catch (err) {
    console.error('[PromoService] ❌ Erreur lors de addPromotion :', err.message || err);
    return false;
  }
}

/**
 * Supprime une promotion dans Google Sheets via Make.
 * 
 * @param {string|number} promoId - Identifiant unique de la promotion
 * @returns {Promise<boolean>}
 */
export async function removePromotion(promoId) {
  if (!promoId) {
    console.warn('[PromoService] ⚠️ removePromotion ignoré : promoId manquant.');
    return false;
  }

  try {
    const payload = { action: 'remove_promo', data: { promoId } };
    const res = await sendToMakeWebhook(payload, 'Promotions');

    // Vérification de la réponse de Make
    if (res?.ok === false) {
      console.warn('[PromoService] ⚠️ Make a retourné une erreur lors de removePromotion :', res);
      return false;
    }

    console.log(`[PromoService] ✅ Promotion ${promoId} supprimée avec succès.`);
    return true;

  } catch (err) {
    console.error('[PromoService] ❌ Erreur lors de removePromotion :', err.message || err);
    return false;
  }
}
