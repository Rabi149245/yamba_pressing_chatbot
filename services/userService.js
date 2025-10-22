import { sendToMakeWebhook } from './makeService.js';

// ---------------------------
// Récupérer la dernière date de message du client
// ---------------------------
export async function getUserLastMessage(phone) {
    try {
        // On demande à Make de renvoyer la date du dernier message
        const payload = { phone };
        const response = await sendToMakeWebhook(payload, 'Users_getLastMessage');
        return response?.LastOrderAt || null;
    } catch (err) {
        console.error('getUserLastMessage error:', err);
        return null;
    }
}

// ---------------------------
// Mise à jour dernière date de message
// ---------------------------
export async function updateUserLastMessage(phone, date) {
    try {
        await sendToMakeWebhook({ phone, lastMessageAt: date }, 'Users_updateLastMessage');
    } catch (err) {
        console.error('updateUserLastMessage error:', err);
    }
}