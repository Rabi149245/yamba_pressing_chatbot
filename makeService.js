import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const MAKE_API_KEY = process.env.MAKE_API_KEY;
const DEBUG_MAKE = process.env.DEBUG_MAKE === 'true';

// ─── Queue persistante (fire-and-forget) ──────────────────────────────────────
const QUEUE_FILE = path.resolve('./makeQueue.json');
const PROCESS_INTERVAL = 3000;
const MAX_RETRIES = 5;

let queue = [];
try {
  if (fs.existsSync(QUEUE_FILE)) {
    queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
  }
} catch (err) {
  console.warn('[Make] Impossible de charger la queue:', err.message);
}

function saveQueue() {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  } catch (err) {
    console.error('[Make] Échec sauvegarde queue:', err.message);
  }
}

if (!MAKE_WEBHOOK_URL) console.warn('⚠️ MAKE_WEBHOOK_URL manquant — les appels Make échoueront.');
if (!MAKE_API_KEY)     console.warn('⚠️ MAKE_API_KEY manquant — les appels Make seront refusés.');

// ─── Headers communs ──────────────────────────────────────────────────────────
function makeHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-make-apikey': MAKE_API_KEY,
  };
}

// ─── sendToMakeWebhook : fire-and-forget via queue ───────────────────────────
// À utiliser pour : logs, notifications, création d'ordres, pickups, etc.
// Ne retourne PAS les données Make — uniquement { ok: true }.
export async function sendToMakeWebhook(payload, event = 'unknown_event') {
  if (!MAKE_WEBHOOK_URL || !MAKE_API_KEY) {
    console.error('[Make] ❌ Variables env manquantes');
    return { ok: false, error: 'Missing env vars' };
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    console.error('[Make] Payload invalide, doit être un objet');
    return { ok: false, error: 'Invalid payload format' };
  }

  queue.push({ payload, event, retries: 0 });
  saveQueue();
  if (DEBUG_MAKE) console.log(`[Make] Ajouté queue → ${event}`);
  return { ok: true };
}

// ─── callMakeAndWait : appel synchrone avec réponse attendue ──────────────────
// À utiliser pour : assignAgent, getPoints, listPromotions, get_pending_orders.
// Retourne directement la réponse JSON de Make.
export async function callMakeAndWait(payload, event) {
  if (!MAKE_WEBHOOK_URL || !MAKE_API_KEY) {
    console.error('[Make] ❌ callMakeAndWait : variables env manquantes');
    return null;
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    console.error('[Make] callMakeAndWait : payload invalide');
    return null;
  }

  const body = {
    event,
    payload,
    ts: new Date().toISOString(),
    id: `mk_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
  };

  try {
    const res = await axios.post(MAKE_WEBHOOK_URL, body, {
      timeout: 10000,
      headers: makeHeaders(),
    });
    if (DEBUG_MAKE) console.log(`[Make] callMakeAndWait ← ${event}:`, JSON.stringify(res.data).slice(0, 300));
    return res.data ?? null;
  } catch (err) {
    console.error(`[Make] ❌ callMakeAndWait error (${event}):`, err.response?.data || err.message);
    return null;
  }
}

// ─── Traitement de la queue ───────────────────────────────────────────────────
async function processQueue() {
  if (queue.length === 0) return;

  const item = queue[0];
  const body = {
    event: item.event,
    payload: item.payload,
    ts: new Date().toISOString(),
    id: `mk_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
  };

  try {
    const res = await axios.post(MAKE_WEBHOOK_URL, body, {
      timeout: 10000,
      headers: makeHeaders(),
    });

    if (res.status !== 200) {
      console.warn(`[Make] HTTP ${res.status} - ${res.statusText}`);
      return;
    }

    if (DEBUG_MAKE) console.log('[Make → OK]', JSON.stringify(res.data).slice(0, 300));
    queue.shift();
    saveQueue();
  } catch (err) {
    item.retries++;
    console.warn('[Make] Webhook error:', err.response?.data || err.message, `(retry ${item.retries})`);

    if (item.retries >= MAX_RETRIES) {
      console.error(`[Make] Échec définitif après ${MAX_RETRIES} retries pour ${item.event}`);
      queue.shift();
      saveQueue();
    } else {
      const delay = 1000 * Math.pow(2, item.retries);
      setTimeout(() => processQueue(), delay);
    }
  }
}

if (!global._makeQueueInterval) {
  global._makeQueueInterval = setInterval(() => processQueue(), PROCESS_INTERVAL);
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────
export function formatMakePayload(type, data = {}, meta = {}) {
  return {
    id: `mk_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    type,
    data,
    meta,
    ts: new Date().toISOString(),
  };
}

export function validateMakeSignature(headers, rawBody, secret = process.env.MAKE_SIGNATURE_SECRET) {
  if (!secret) return true;

  const signature = headers['x-make-signature'] || headers['x-hook-signature'];
  if (!signature) {
    console.warn('[Make] Signature absente');
    return false;
  }

  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const valid = computed === signature;

  if (DEBUG_MAKE) console.log('[Make] Validation signature', { valid });
  return valid;
}
