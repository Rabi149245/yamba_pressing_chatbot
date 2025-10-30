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

  // Vérification de la validité du rating (entre 1 et 5)
  if (rating && (rating < 1 || rating > 5)) {
    console.warn('⚠️ logFeedback ignoré : rating invalide, doit être entre 1 et 5.');
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

    // Vérification de la réponse de Make
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
