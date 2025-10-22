import { sendToMakeWebhook } from './makeService.js';

// ---------------------------
// Récupérer un agent disponible
// ---------------------------
export async function assignAgent() {
    try {
        const agent = await sendToMakeWebhook({}, 'Agents_getAvailable');
        return agent || null; // { Name, Phone }
    } catch (err) {
        console.error('assignAgent error:', err);
        return null;
    }
}