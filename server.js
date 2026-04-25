import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cron from 'node-cron';

// ─── Imports (tous les fichiers sont à la RACINE du projet) ───────────────────
import { handleIncomingMessage, sendWhatsAppMessage } from './whatsappService.js';
import { sendToMakeWebhook, validateMakeSignature } from './makeService.js';
import { readCatalog } from './orderService.js';
import { checkAndSendReminders } from './reminderService.js';
import { listPromotions, addPromotion, removePromotion } from './promoService.js';
import { logFeedback } from './feedbackService.js';
import { handlePickupRequest } from './pickupService.js';
import { getPoints, addPoints } from './pointsService.js';

// ─── Vérification variables critiques ────────────────────────────────────────
const REQUIRED_VARS = ['MAKE_WEBHOOK_URL', 'MAKE_API_KEY', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'VERIFY_TOKEN'];
const missing = REQUIRED_VARS.filter(v => !process.env[v]);
if (missing.length) {
  console.error(`❌ Variables manquantes : ${missing.join(', ')}`);
  process.exit(1);
}

const PORT             = process.env.PORT || 5000;
const ENABLE_REMINDERS = process.env.ENABLE_REMINDERS === 'true';
const DEBUG_MAKE       = process.env.DEBUG_MAKE === 'true';

console.log(`🚀 Démarrage Yamba Pressing Chatbot — port ${PORT}`);
console.log(`📡 Webhook Make : ${process.env.MAKE_WEBHOOK_URL}`);
console.log(`⏰ Rappels automatiques : ${ENABLE_REMINDERS ? 'activés' : 'désactivés'}`);

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();

app.use(
  bodyParser.json({
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
  })
);

// ─── Santé du serveur ─────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ status: 'ok', service: 'Yamba Pressing Chatbot', ts: new Date().toISOString() }));

// ─── Catalogue ────────────────────────────────────────────────────────────────
app.get('/catalogue', async (_req, res) => {
  try {
    const data = await readCatalog();
    return res.json({ status: 'ok', count: data.length, catalogue: data });
  } catch (err) {
    console.error('[Server] ❌ /catalogue :', err.message);
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

// ─── Webhook WhatsApp — vérification (GET) ────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('[Server] ✅ Webhook WhatsApp vérifié');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ─── Webhook WhatsApp — réception messages (POST) ────────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    // Validation signature Make (si configurée)
    if (!validateMakeSignature(req.headers, req.rawBody)) {
      console.warn('[Server] ⚠️ Signature Make invalide — requête refusée');
      return res.status(401).send('Invalid signature');
    }

    const body = req.body;
    if (DEBUG_MAKE) console.log('[WEBHOOK IN]', JSON.stringify(body, null, 2));

    // Log fire-and-forget vers Make
    sendToMakeWebhook({ event: 'incoming_message', payload: body }, 'incoming_message').catch(() => {});

    // Extraction du message WhatsApp
    const entry   = body?.entry?.[0];
    const change  = entry?.changes?.[0];
    const message =
      change?.value?.messages?.[0] ||
      entry?.messaging?.[0]        ||
      body?.message;

    if (message) {
      await handleIncomingMessage(message);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('[Server] ❌ /webhook POST :', err.message);
    return res.sendStatus(500);
  }
});

// ─── Pickup ───────────────────────────────────────────────────────────────────
app.post('/pickup', async (req, res) => {
  const { phone, clientName, lat, lon, address } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone requis' });

  try {
    const msg = await handlePickupRequest(phone, clientName);
    // Enrichir Make avec les coordonnées GPS si fournies
    if (lat && lon) {
      sendToMakeWebhook({ event: 'create_pickup', payload: { phone, clientName, lat, lon, address } }, 'Pickups').catch(() => {});
    }
    return res.json({ status: 'ok', message: msg });
  } catch (err) {
    console.error('[Server] ❌ /pickup :', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Commande ─────────────────────────────────────────────────────────────────
app.post('/commande', async (req, res) => {
  if (!req.body?.ClientPhone) return res.status(400).json({ error: 'ClientPhone requis' });
  try {
    await sendToMakeWebhook({ event: 'create_order', payload: req.body }, 'Orders');
    return res.json({ status: 'ok', message: 'Commande transmise à Make' });
  } catch (err) {
    console.error('[Server] ❌ /commande :', err.message);
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

// ─── Promotions ───────────────────────────────────────────────────────────────
app.get('/promotions', async (_req, res) => {
  try {
    const promos = await listPromotions();
    return res.json({ status: 'ok', count: promos.length, promotions: promos });
  } catch (err) {
    console.error('[Server] ❌ GET /promotions :', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/promotions', async (req, res) => {
  const { title, description, discount, validUntil } = req.body;
  if (!title || !discount || !validUntil) {
    return res.status(400).json({ error: 'title, discount et validUntil sont requis' });
  }
  try {
    const ok = await addPromotion({ title, description, discount, validUntil });
    return res.json({ status: ok ? 'ok' : 'error' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/promotions/:id', async (req, res) => {
  try {
    const ok = await removePromotion(req.params.id);
    return res.json({ status: ok ? 'ok' : 'error' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Fidélité / Points ────────────────────────────────────────────────────────
app.get('/fidelite/:phone', async (req, res) => {
  try {
    const pts = await getPoints(req.params.phone);
    return res.json({ status: 'ok', phone: req.params.phone, points: pts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/fidelite', async (req, res) => {
  const { phone, points, reason } = req.body;
  if (!phone || !points) return res.status(400).json({ error: 'phone et points requis' });
  try {
    await addPoints(phone, points, reason);
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Feedback ─────────────────────────────────────────────────────────────────
app.post('/feedback', async (req, res) => {
  const { phone, message, rating } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone et message requis' });
  try {
    const ok = await logFeedback(phone, message, rating ?? null);
    return res.json({ status: ok ? 'ok' : 'error' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Escalade humaine ─────────────────────────────────────────────────────────
app.post('/human', async (req, res) => {
  const { phone, clientName, message } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone requis' });
  try {
    await sendToMakeWebhook({ event: 'escalate_to_human', payload: { phone, clientName, message } }, 'escalate_to_human');
    return res.json({ status: 'ok', message: 'Demande transmise' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Envoi WhatsApp direct (usage admin) ─────────────────────────────────────
app.post('/send-whatsapp', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'to et message requis' });
  try {
    const ok = await sendWhatsAppMessage(to, message);
    return res.json({ status: ok ? 'ok' : 'error' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Cron rappels quotidiens ──────────────────────────────────────────────────
if (ENABLE_REMINDERS) {
  cron.schedule('0 9 * * *', async () => {
    console.log('[Cron] Vérification des rappels...');
    try {
      await checkAndSendReminders();
    } catch (err) {
      console.error('[Cron] ❌ Erreur rappels :', err.message);
    }
  });
  console.log('[Cron] ✅ Rappels planifiés à 9h00 chaque jour.');
}

// ─── Lancement ────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`✅ Serveur démarré sur le port ${PORT}`));
