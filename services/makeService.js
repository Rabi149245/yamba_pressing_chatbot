// src/services/makeService.js
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const MAKE_API_KEY = process.env.MAKE_API_KEY;
const DEBUG_MAKE = process.env.DEBUG_MAKE === 'true';

// Fichier pour persister la queue
const QUEUE_FILE = path.resolve('./makeQueue.json');
const PROCESS_INTERVAL = 3000; // toutes les 3 secondes
const MAX_RETRIES = 5;

// Queue persistante
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

// ---------------------------
// Vérification initiale (au démarrage)
// ---------------------------
if (!MAKE_WEBHOOK_URL) console.warn('⚠️ MAKE_WEBHOOK_URL manquant — les appels Make échoueront.');
if (!MAKE_API_KEY) console.warn('⚠️ MAKE_API_KEY manquant — les appels Make seront refusés.');

// ---------------------------
// 📨 Envoie un événement vers Make avec queue et retry automatique
// ---------------------------
export async function sendToMakeWebhook(payload, event = 'unknown_event') {
  if (!MAKE_WEBHOOK_URL || !MAKE_API_KEY) {
    console.error('❌ Impossible d’envoyer à Make : variables non configurées');
    return { ok: false, error: 'Missing env vars' };
  }

  // ✅ Validation des données avant ajout à la queue
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    console.error('[MAKE] Payload invalide, doit être un objet');
    return { ok: false, error: 'Invalid payload format' };
  }

  queue.push({ payload, event, retries: 0 });
  saveQueue();

  if (DEBUG_MAKE) console.log(`[MAKE] Ajouté à la queue → ${event}`);

  return { ok: true };
}

// ---------------------------
// Traitement automatique de la queue
// ---------------------------
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
      headers: {
        'Content-Type': 'application/json',
        'x-make-apikey': MAKE_API_KEY,
      },
    });

    if (res.status !== 200) {
      console.warn(`[MAKE] HTTP ${res.status} - ${res.statusText}`);
      return;
    }

    if (DEBUG_MAKE) console.log('[MAKE → OK]', JSON.stringify(res.data).slice(0, 500));

    // ✅ Suppression réussie de l’élément traité
    queue.shift();
    saveQueue();
  } catch (err) {
    item.retries++;
    console.warn('[MAKE] Webhook error:', err.response?.data || err.message, `(retry ${item.retries})`);

    if (item.retries >= MAX_RETRIES) {
      console.error(`[MAKE] Échec définitif après ${MAX_RETRIES} retries pour ${item.event}`);
      queue.shift();
      saveQueue();
    } else {
      // ✅ Retry avec délai exponentiel sécurisé
      const delay = 1000 * Math.pow(2, item.retries);
      setTimeout(() => processQueue(), delay);
      return;
    }
  }
}

// ✅ Intervalle unique et protégé (empêche double exécution)
if (!global._makeQueueInterval) {
  global._makeQueueInterval = setInterval(() => processQueue(), PROCESS_INTERVAL);
}

// ---------------------------
// 🧱 Formate un payload standardisé
// ---------------------------
export function formatMakePayload(type, data = {}, meta = {}) {
  return {
    id: `mk_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    type,
    data,
    meta,
    ts: new Date().toISOString(),
  };
}

// ---------------------------
// 🔒 Vérifie la signature Make pour les webhooks entrants
// ---------------------------
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
