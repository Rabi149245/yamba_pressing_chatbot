import { sendToMakeWebhook } from './makeService.js';

/**
 * Enregistre un feedback client dans Google Sheets via Make (fire-and-forget).
 * Le scénario Make "Feedbacks_add" reçoit : { phone, message, rating, ts }
 *
 * @param {string}      phone   - Numéro WhatsApp du client
 * @param {string}      message - Contenu du feedback
 * @param {number|null} rating  - Note 1 à 5 (optionnelle)
 */
export async function logFeedback(phone, message, rating = null) {
  if (!phone || !message) {
    console.warn('[FeedbackService] ⚠️ logFeedback ignoré : phone ou message manquant.');
    return false;
  }

  if (rating !== null && (isNaN(rating) || rating < 1 || rating > 5)) {
    console.warn('[FeedbackService] ⚠️ logFeedback : rating invalide (doit être entre 1 et 5).');
    return false;
  }

  try {
    const payload = {
      phone,
      message,
      rating: rating !== null ? Number(rating) : null,
      ts: new Date().toISOString(),
    };

    await sendToMakeWebhook(payload, 'Feedbacks_add');
    console.log(`[FeedbackService] ✅ Feedback enregistré pour ${phone}.`);
    return true;
  } catch (err) {
    console.error('[FeedbackService] ❌ logFeedback :', err.message);
    return false;
  }
}
