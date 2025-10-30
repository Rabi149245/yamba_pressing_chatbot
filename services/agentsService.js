import { sendToMakeWebhook } from './makeService.js';

/**
 * Récupère un agent disponible depuis Make
 * L’API Make doit renvoyer un objet { Name, Phone } ou null.
 */
export async function assignAgent() {
  try {
    // Appel à Make pour récupérer un agent disponible
    const response = await sendToMakeWebhook({ action: 'get_available_agent' }, 'Agents_getAvailable');

    // Vérifie la structure de la réponse
    if (!response || typeof response !== 'object') {
      console.warn('[AgentsService] ⚠️ Réponse Make invalide ou vide', response);
      return null;
    }

    const { Name, Phone } = response;

    // Validation basique
    if (!Phone) {
      console.warn('[AgentsService] ⚠️ Agent sans numéro', response);
      return null;
    }

    console.log(`[AgentsService] ✅ Agent assigné : ${Name || 'Inconnu'} (${Phone})`);
    return { Name: Name || 'Agent', Phone };
  } catch (err) {
    console.error('[AgentsService] ❌ assignAgent error:', err.response?.data || err.message);
    return null;
  }
}
