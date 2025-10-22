import { sendToMakeWebhook } from './makeService.js';

// ---------------------------
// Log d'une notification
// ---------------------------
export async function logNotification(phone, message, mediaUrl = null, type = 'Message') {
    try {
        await sendToMakeWebhook({ phone, message, mediaUrl, type, ts: new Date().toISOString() }, 'NotificationsLog_add');
    } catch (err) {
        console.error('logNotification error:', err);
    }
}