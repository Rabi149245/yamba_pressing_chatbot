// src/services/notificationsService.js
import { sendToMakeWebhook } from './makeService.js';

/**
 * Journalise une notification envoyée (texte, média, etc.) dans Google Sheets via Make.
 *
 * Le scénario Make "NotificationsLog_add" doit recevoir :
 * { phone, message, mediaUrl, type, ts }
 *
 * @param {string} phone - Numéro de téléphone du client
 * @param {string} message - Message texte envoyé
 * @param {string|null} mediaUrl - Lien du média (facultatif)
 * @param {string} type - Type de message (Message, Reminder, Info, etc.)
 * @returns {Promise<boolean>}
 */
export async function logNotification(phone, message, mediaUrl = null, type = 'Message') {
  if (!phone || !message) {
    console.warn('⚠️ logNotification ignoré : phone ou message manquant.');
    return false;
  }

  try {
    const payload = {
      phone,
      message,
      mediaUrl,
      type,
      ts: new Date().toISOString()
    };

    const res = await sendToMakeWebhook(payload, 'NotificationsLog_add');

    if (res?.ok === false) {
      console.warn('⚠️ Make a retourné une erreur lors du log de notification :', res);
      return false;
    }

    console.log(`✅ Notification enregistrée pour ${phone} (${type}).`);
    return true;
  } catch (err) {
    console.error('❌ logNotification error:', err.message || err);
    return false;
  }
}
