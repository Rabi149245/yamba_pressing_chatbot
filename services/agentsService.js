// src/services/agentsService.js
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
      console.warn('assignAgent: réponse Make invalide ou vide', response);
      return null;
    }

    const { Name, Phone } = response;

    // Validation basique
    if (!Phone) {
      console.warn('assignAgent: agent sans numéro', response);
      return null;
    }

    console.log(`✅ Agent assigné : ${Name || 'Inconnu'} (${Phone})`);
    return { Name: Name || 'Agent', Phone };
  } catch (err) {
    console.error('❌ assignAgent error:', err.response?.data || err.message);
    return null;
  }
}
