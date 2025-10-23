// src/services/promoService.js
import { sendToMakeWebhook } from './makeService.js';

/**
 * Récupère la liste des promotions depuis Google Sheets via Make
 */
export async function listPromotions() {
    try {
        // Make event "list_promos" doit lire le Google Sheet et renvoyer les promos
        const promos = await sendToMakeWebhook({ event: 'list_promos' }, 'Promotions');
        // Assurez-vous que Make renvoie un tableau de promotions
        return Array.isArray(promos) ? promos : [];
    } catch (err) {
        console.error('listPromotions error:', err);
        return [];
    }
}

/**
 * Ajouter une promotion dans Google Sheets via Make
 * @param {Object} promo { title: string, description: string, discount: number, validUntil: string }
 */
export async function addPromotion(promo) {
    try {
        await sendToMakeWebhook({ event: 'add_promo', payload: promo }, 'Promotions');
        return true;
    } catch (err) {
        console.error('addPromotion error:', err);
        throw err;
    }
}

/**
 * Supprimer une promotion dans Google Sheets via Make
 * @param {string|number} promoId ID unique de la promotion
 */
export async function removePromotion(promoId) {
    try {
        await sendToMakeWebhook({ event: 'remove_promo', payload: { promoId } }, 'Promotions');
        return true;
    } catch (err) {
        console.error('removePromotion error:', err);
        throw err;
    }
}