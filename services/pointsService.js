import { sendToMakeWebhook } from './makeService.js';

// ---------------------------
// Ajouter des points pour un client
// ---------------------------
export async function addPoints(clientPhone, points, reason = '') {
    try {
        await sendToMakeWebhook({ clientPhone, points, reason, ts: new Date().toISOString() }, 'PointsTransactions_add');
    } catch (err) {
        console.error('addPoints error:', err);
    }
}

// ---------------------------
// Récupérer le solde de points
// ---------------------------
export async function getPoints(clientPhone) {
    try {
        const response = await sendToMakeWebhook({ clientPhone }, 'PointsTransactions_get');
        return response?.points || 0;
    } catch (err) {
        console.error('getPoints error:', err);
        return 0;
    }
}