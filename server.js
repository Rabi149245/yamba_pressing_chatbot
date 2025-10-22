// server.js (ESM)
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cron from 'node-cron';
import { handleIncomingMessage, sendText } from './services/whatsappService.js';
import { sendToMakeWebhook } from './services/makeService.js';
import { readCatalog } from './services/orderService.js';
import { checkAndSendReminders } from './services/reminderService.js';

const PORT = process.env.PORT || 5000;
const ENABLE_REMINDERS = process.env.ENABLE_REMINDERS === 'true';

console.log('Yamba Chatbot - starting');
console.log('Port:', PORT);
console.log('Make webhook:', process.env.MAKE_WEBHOOK_URL ? 'configured' : 'NOT configured');
console.log('Reminders enabled:', ENABLE_REMINDERS);

const app = express();
app.use(bodyParser.json());

// Root
app.get('/', (req, res) => res.send('Yamba Pressing Chatbot - Ready'));

// Catalogue (debug)
app.get('/catalogue', async (req, res) => {
  try {
    const cat = await readCatalog();
    return res.json({ status: 'ok', catalogue: cat });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

// Webhook verification (GET)
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

// Webhook receiver (POST) — WhatsApp events forwarded here
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    // Forward raw event to Make for logging/analytics (best-effort)
    if (process.env.MAKE_WEBHOOK_URL) {
      try {
        await sendToMakeWebhook({ event: 'incoming_raw', payload: body }, 'incoming_raw');
      } catch (e) {
        console.warn('Failed to forward raw incoming to Make:', e.message);
      }
    }

    // Normalize message object (WhatsApp cloud shape)
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0] || entry?.messaging?.[0] || body.message;

    if (message) {
      await handleIncomingMessage(message);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook handling error', err);
    res.sendStatus(500);
  }
});

/**
 * Endpoint to allow Make to tell server to send a WhatsApp message directly
 * (Make can also call WhatsApp via its own HTTP modules; this endpoint is optional)
 * Body: { to, text }
 */
app.post('/send-whatsapp', async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: 'Missing to or text' });
  try {
    const ok = await sendText(to, text);
    return res.json({ status: ok ? 'sent' : 'failed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Pickup creation endpoint (optional alternative)
app.post('/pickup', async (req, res) => {
  const { phone, lat, lon, address, orderId } = req.body;
  if (!process.env.MAKE_WEBHOOK_URL) return res.status(500).json({ error: 'Make webhook not configured' });
  try {
    const data = { clientPhone: phone, lat, lon, address, orderId };
    const resp = await sendToMakeWebhook({ action: 'create_pickup', payload: data }, 'create_pickup');
    return res.json({ status: 'ok', make: resp });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Create human request (alternative endpoint)
app.post('/human-request', async (req, res) => {
  const { phone, note } = req.body;
  try {
    const resp = await sendToMakeWebhook({ action: 'create_human_request', payload: { clientPhone: phone, note } }, 'create_human_request');
    return res.json({ status: 'ok', make: resp });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Promotions listing (proxy)
app.get('/promotions', async (req, res) => {
  try {
    const resp = await sendToMakeWebhook({ action: 'get_active_promos' }, 'get_active_promos');
    return res.json({ status: 'ok', promos: resp?.promos || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Reminders cron — delegate to Make which will return list of notifications to send
if (ENABLE_REMINDERS) {
  cron.schedule('0 9 * * *', async () => {
    try {
      console.log('Running daily reminder check (server -> Make)');
      await checkAndSendReminders();
    } catch (e) {
      console.error('Reminder cron error', e);
    }
  });
  console.log('Cron reminders scheduled at 09:00 daily');
}

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
