// Charger les variables d'environnement depuis le fichier .env (ESM)
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cron from 'node-cron';
import { handleIncomingMessage } from './services/whatsappService.js';
import { sendToMakeWebhook } from './services/makeService.js';
import { readCatalog } from './services/orderService.js';
import { checkAndSendReminders } from './services/reminderService.js';

// ---------------------------
// Vérification des variables critiques
// ---------------------------
if (!process.env.MAKE_WEBHOOK_URL) {
    console.error("Erreur : MAKE_WEBHOOK_URL n'est pas configurée !");
    process.exit(1);
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
    return res.json({status:'ok', catalogue: data});
  } catch (err) {
    return res.status(500).json({status:'error', error: err.message});
  }
});

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

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (process.env.MAKE_WEBHOOK_URL) {
      try { 
        await sendToMakeWebhook({event:'incoming_message', payload: body}, 'incoming_message'); 
      } catch(e){ console.warn('Make forward failed', e.message); }
    }
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0] || entry?.messaging?.[0] || body.message;
    if (message) {
      await handleIncomingMessage(message);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error', err);
    res.sendStatus(500);
  }
});

// Routes supplémentaires (pickup, commande, promotions, fidélité)
app.post('/pickup', async (req, res) => {
  const { phone, lat, lon, address } = req.body;
  if (!process.env.MAKE_WEBHOOK_URL) return res.status(500).json({error:'Make webhook not configured'});
  try {
    await sendToMakeWebhook({event:'create_pickup', payload:{phone, lat, lon, address}}, 'create_pickup');
    return res.json({status:'ok', message:'Pickup request forwarded'});
  } catch(err) {
    return res.status(500).json({error: err.message});
  }
});

app.post('/commande', async (req, res) => {
  const body = req.body;
  try {
    await sendToMakeWebhook({event:'create_order', payload: body}, 'create_order');
    return res.json({status:'ok', message:'Order forwarded to Make'});
  } catch(err) {
    return res.status(500).json({status:'error', error: err.message});
  }
});

app.get('/promotions', async (req, res) => {
  try {
    await sendToMakeWebhook({event:'list_promos'}, 'list_promos');
    return res.json({status:'requested'});
  } catch(e) {
    return res.status(500).json({error:e.message});
  }
});

app.post('/fidelite', async (req, res) => {
  try {
    await sendToMakeWebhook({event:'update_points', payload:req.body}, 'update_points');
    return res.json({status:'ok'});
  } catch(e) {
    return res.status(500).json({error:e.message});
  }
});

// ---------------------------
// Cron pour rappels
// ---------------------------
if (ENABLE_REMINDERS) {
  cron.schedule('0 9 * * *', async () => {
    try {
      console.log('Running daily reminder check...');
      await checkAndSendReminders();
    } catch(e) {
      console.error('Reminder error', e);
    }
  });
  console.log('Reminders enabled (cron scheduled).');

// ---------------------------
// Lancement du serveur
// ---------------------------
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
