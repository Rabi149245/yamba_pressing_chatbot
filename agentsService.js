import { callMakeAndWait } from './makeService.js';

/**
 * Récupère un agent disponible depuis Make (appel synchrone avec réponse).
 * Le scénario Make "Agents_getAvailable" doit retourner : { Name, Phone }
 */
export async function assignAgent() {
  try {
    const response = await callMakeAndWait({ action: 'get_available_agent' }, 'Agents_getAvailable');

    if (!response || typeof response !== 'object') {
      console.warn('[AgentsService] ⚠️ Réponse Make invalide ou vide', response);
      return null;
    }

    const { Name, Phone } = response;

    if (!Phone) {
      console.warn('[AgentsService] ⚠️ Agent sans numéro de téléphone', response);
      return null;
    }

    console.log(`[AgentsService] ✅ Agent assigné : ${Name || 'Agent'} (${Phone})`);
    return { Name: Name || 'Agent', Phone };
  } catch (err) {
    console.error('[AgentsService] ❌ assignAgent error:', err.message);
    return null;
  }
}
