// src/services/makeService.js
import axios from 'axios';
import crypto from 'crypto';

const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const MAKE_API_KEY = process.env.MAKE_API_KEY;
const DEBUG_MAKE = process.env.DEBUG_MAKE === 'true';

// Vérification initiale (au démarrage)
if (!MAKE_WEBHOOK_URL) console.warn('⚠️ MAKE_WEBHOOK_URL manquant — les appels Make échoueront.');
if (!MAKE_API_KEY) console.warn('⚠️ MAKE_API_KEY manquant — les appels Make seront refusés.');

/**
 * 📨 Envoie un événement vers Make
 */
export async function sendToMakeWebhook(payload, event = 'event') {
  if (!MAKE_WEBHOOK_URL || !MAKE_API_KEY) {
    console.error('❌ Impossible d’envoyer à Make : variables non configurées');
    return { ok: false, error: 'Missing env vars' };
  }

  const body = {
    event,
    payload,
    ts: new Date().toISOString(),
    id: `mk_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  };

  try {
    const res = await axios.post(MAKE_WEBHOOK_URL, body, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'x-make-apikey': MAKE_API_KEY,
      },
    });

    if (res.status !== 200) {
      console.warn(`[MAKE] HTTP ${res.status} - ${res.statusText}`);
      return { ok: false, error: `HTTP ${res.status}` };
    }

    if (DEBUG_MAKE) console.log('[MAKE → OK]', JSON.stringify(res.data).slice(0, 500));

    return { ok: true, data: res.data };
  } catch (err) {
    console.error('[MAKE] Webhook error:', err.response?.data || err.message);
    return { ok: false, error: err.response?.data || err.message };
  }
}

/**
 * 🧱 Formate un payload standardisé
 */
export function formatMakePayload(type, data = {}, meta = {}) {
  return {
    id: `mk_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    type,
    data,
    meta,
    ts: new Date().toISOString(),
  };
}

/**
 * 🔒 Vérifie la signature Make pour les webhooks entrants
 */
export function validateMakeSignature(headers, rawBody, secret = process.env.MAKE_SIGNATURE_SECRET) {
  if (!secret) return true;

  const signature = headers['x-make-signature'] || headers['x-hook-signature'];
  if (!signature) {
    console.warn('[MAKE] Signature absente');
    return false;
  }

  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const valid = computed === signature;

  if (DEBUG_MAKE) console.log('[MAKE] Validation signature', { signature, computed, valid });

  return valid;
}
