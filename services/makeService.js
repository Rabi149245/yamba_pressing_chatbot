// makeService.js
import axios from 'axios';
import crypto from 'crypto';

// 🔧 Variables d’environnement nécessaires
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const MAKE_SIGNATURE_SECRET = process.env.MAKE_SIGNATURE_SECRET || ''; // optionnel si signature activée
const DEBUG_MAKE = process.env.DEBUG_MAKE === 'true';

/**
 * 📨 Envoie un événement vers le webhook Make
 * @param {Object} payload - Données à envoyer
 * @param {string} event - Nom de l’événement (ex: 'order_created')
 * @returns {Object} - Réponse complète du webhook Make
 */
export async function sendToMakeWebhook(payload, event = 'event') {
  if (!MAKE_WEBHOOK_URL) throw new Error('MAKE_WEBHOOK_URL not configured');

  const body = {
    event,
    payload,
    ts: new Date().toISOString(),
  };

  try {
    const res = await axios.post(MAKE_WEBHOOK_URL, body, { timeout: 10000 });

    // ✅ Gestion HTTP codes ≠200
    if (res.status !== 200) {
      console.error(`[MAKE] HTTP ${res.status} - ${res.statusText}`);
      throw new Error(`Make webhook error: HTTP ${res.status}`);
    }

    if (DEBUG_MAKE) console.log('[MAKE → OK]', JSON.stringify(res.data, null, 2));

    return res.data; // 🔁 Retourne les données réelles
  } catch (err) {
    console.error('[MAKE] Webhook error:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * 🧱 Formate un payload standardisé pour Make
 * @param {string} type - Type d’événement (ex: "order_created")
 * @param {Object} data - Données principales
 * @param {Object} meta - Métadonnées facultatives
 */
export function formatMakePayload(type, data = {}, meta = {}) {
  return {
    type,
    data,
    meta,
    ts: new Date().toISOString(),
  };
}

/**
 * 🔒 Vérifie la signature Make (sécurité webhook entrant)
 * @param {Object} headers - En-têtes HTTP reçus
 * @param {string} rawBody - Corps brut de la requête
 * @returns {boolean} - true si signature valide
 */
export function validateMakeSignature(headers, rawBody) {
  if (!MAKE_SIGNATURE_SECRET) return true; // désactivé si non configuré

  const signature = headers['x-make-signature'] || headers['x-hook-signature'];
  if (!signature) {
    console.warn('[MAKE] Signature absente');
    return false;
  }

  const computed = crypto
    .createHmac('sha256', MAKE_SIGNATURE_SECRET)
    .update(rawBody)
    .digest('hex');

  const valid = computed === signature;

  if (DEBUG_MAKE) {
    console.log('[MAKE] Validation signature', { signature, computed, valid });
  }

  return valid;
}
