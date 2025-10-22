// server.js
// Charger les variables d'environnement depuis le fichier .env (ESM)
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cron from 'node-cron';
import { handleIncomingMessage, sendText } from './services/whatsappService.js';
import { sendToMakeWebhook } from './services/makeService.js';
import { readCatalog } from './services/orderService.js';
import { checkAndSendReminders } from './services/reminderService.js';

// ---------------------------
// Vérification des variables critiques
// ---------------------------
if (!process.env.MAKE_WEBHOOK_URL) {
  console.warn("Attention : MAKE_WEBHOOK_URL n'est pas configurée. Certaines fonctionnalités basées sur Google Sheets via Make ne fonctionneront pas.");
}
// ---------------------------
// Déclaration des variables
// ---------------------------
const PORT = process.env.PORT || 5000;
const ENABLE_REMINDERS = process.env.ENABLE_REMINDERS === "true";

// ---------------------------
// Vérification console
// ---------------------------
console.log("Serveur démarré sur le port", PORT);
console.log("Webhook Make :", process.env.MAKE_WEBHOOK_URL);
console.log("Rappels activés :", ENABLE_REMINDERS);

// ---------------------------
// Initialisation Express
// ---------------------------
const app = express();
app.use(bodyParser.json());

// ---------------------------
// Routes
// ---------------------------
app.get('/', (req, res) => res.send('Yamba Pressing Chatbot - Ready'));

app.get('/catalogue', async (req, res) => {
  try {
    const data = await readCatalog();
    return res.json({ status: 'ok', catalogue: data });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

// Endpoint pour la vérification Meta webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }
  res.sendStatus(200);
});

// Webhook d'entrée: Meta -> ton serveur
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    // Forward raw incoming to Make for analytics / lastSeen check / decide greeting
    if (process.env.MAKE_WEBHOOK_URL) {
      try {
        // Note: event name 'incoming_message' — Make will check Clients sheet and decide whether to send greeting/menu via /send-whatsapp
        await sendToMakeWebhook({ incoming: body }, 'incoming_message');
      } catch (e) {
        console.warn('Make forward failed', e.message);
      }
    }

    // Extract message (compatibilité avec différents payloads Meta)
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0] || entry?.messaging?.[0] || body.message || body;

    if (message) {
      // Handle conversational logic locally (compute price, confirmations, ask for details, etc.)
      // NOTE: we do not duplicate "incoming_message" forwarding here to avoid duplicates.
      await handleIncomingMessage(message);
    }

    // Respond quickly to Meta
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error', err);
    res.sendStatus(500);
  }
});

// Routes supplémentaires (pickup, commande, promotions, fidélité) utilisées par front/admin or Make
app.post('/pickup', async (req, res) => {
  const { phone, lat, lon, address } = req.body;
  if (!process.env.MAKE_WEBHOOK_URL) return res.status(500).json({ error: 'Make webhook not configured' });
  try {
    await sendToMakeWebhook({ phone, lat, lon, address }, 'create_pickup');
    return res.json({ status: 'ok', message: 'Pickup request forwarded' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/commande', async (req, res) => {
  const body = req.body;
  try {
    await sendToMakeWebhook(body, 'create_order');
    return res.json({ status: 'ok', message: 'Order forwarded to Make' });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

// Endpoint utilisé par Make pour demander la liste des promotions (optionnel)
app.get('/promotions', async (req, res) => {
  try {
    await sendToMakeWebhook({}, 'list_promos');
    return res.json({ status: 'requested' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Endpoint pour update points (Make peut l'appeler pour notifier)
app.post('/fidelite', async (req, res) => {
  try {
    await sendToMakeWebhook(req.body, 'update_points');
    return res.json({ status: 'ok' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ---------------------------
// Cron pour rappels (local trigger qui appelle Make pour exécuter get_pending_orders)
// ---------------------------
if (ENABLE_REMINDERS) {
  cron.schedule('0 9 * * *', async () => {
    try {
      console.log('Running daily reminder check...');
      await checkAndSendReminders();
    } catch (e) {
      console.error('Reminder error', e);
    }
  });
  console.log('Reminders enabled (cron scheduled).');
}

// Endpoint utilisé par Make pour envoyer un message WhatsApp via le bot (Make -> bot)
app.post('/send-whatsapp', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'Missing "to" or "message"' });

  try {
    const result = await sendText(to, message);
    if (result) {
      return res.json({ status: 'ok', message: 'Message envoyé ✅' });
    } else {
      return res.status(500).json({ status: 'error', message: 'Échec de l’envoi' });
    }
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------------------------
// Lancement du serveur
// ---------------------------
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
