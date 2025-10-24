// src/services/feedbackService.js
import { sendToMakeWebhook } from './makeService.js';

/**
 * Enregistre un feedback client (avis, note, etc.) dans Google Sheets via Make.
 *
 * Le scénario Make "Feedbacks_add" doit recevoir :
 * { phone, message, rating, ts }
 *
 * @param {string} phone - Numéro de téléphone du client
 * @param {string} message - Contenu du feedback
 * @param {number|null} rating - Note du client (facultative, 1 à 5)
 * @returns {Promise<boolean>}
 */
export async function logFeedback(phone, message, rating = null) {
  if (!phone || !message) {
    console.warn('⚠️ logFeedback ignoré : phone ou message manquant.');
    return false;
  }

  try {
    const payload = {
      phone,
      message,
      rating,
      ts: new Date().toISOString(),
    };

    const res = await sendToMakeWebhook(payload, 'Feedbacks_add');

    if (res?.ok === false) {
      console.warn('⚠️ Make a retourné une erreur lors du log du feedback :', res);
      return false;
    }

    console.log(`✅ Feedback enregistré pour ${phone}.`);
    return true;
  } catch (err) {
    console.error('❌ logFeedback error:', err.message || err);
    return false;
  }
}