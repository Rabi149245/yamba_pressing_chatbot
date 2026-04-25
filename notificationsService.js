import { sendToMakeWebhook } from './makeService.js';

/**
 * Journalise une notification envoyée dans Google Sheets via Make (fire-and-forget).
 * Le scénario Make "NotificationsLog_add" reçoit : { phone, message, mediaUrl, type, ts }
 *
 * @param {string}      phone    - Numéro du client
 * @param {string}      message  - Message envoyé
 * @param {string|null} mediaUrl - URL du média (optionnel)
 * @param {string}      type     - Type : Message | Reminder | Info | Pickup | HumanEscalation
 */
export async function logNotification(phone, message, mediaUrl = null, type = 'Message') {
  if (!phone || !message) {
    console.warn('[NotificationsService] ⚠️ logNotification ignoré : phone ou message manquant.');
    return false;
  }

  try {
    const payload = {
      phone,
      message,
      mediaUrl,
      type,
      ts: new Date().toISOString(),
    };

    await sendToMakeWebhook(payload, 'NotificationsLog_add');
    console.log(`[NotificationsService] ✅ Notification enregistrée pour ${phone} (${type})`);
    return true;
  } catch (err) {
    console.error('[NotificationsService] ❌ logNotification :', err.message);
    return false;
  }
}
