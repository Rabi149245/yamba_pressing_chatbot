import axios from 'axios';
import { computePriceFromCatalogue, readCatalog } from './orderService.js';
import { sendToMakeWebhook } from './makeService.js';

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const ADMIN_PHONE = process.env.ADMIN_PHONE.replace(/[\s\-+]/g, '').startsWith('226')
  ? process.env.ADMIN_PHONE.replace(/[\s\-+]/g, '')
  : '226' + process.env.ADMIN_PHONE.replace(/[\s\-+]/g, '');

const API_URL = PHONE_ID ? `https://graph.facebook.com/v17.0/${PHONE_ID}/messages` : null;

async function sendText(to, text) {
  if (!TOKEN || !PHONE_ID) {
    console.warn('Missing WhatsApp credentials');
    return false;
  }
  try {
    const payload = { messaging_product: 'whatsapp', to, text: { body: text } };
    const res = await axios.post(API_URL, payload, { 
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      timeout: 15000 
    });
    return res.status === 200 || res.status === 201;
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
    return false;
  }
}

async function handleIncomingMessage(message) {
  const from = message.from;
  if (!from) return;

  if (process.env.MAKE_WEBHOOK_URL) {
    try { await sendToMakeWebhook({incoming: message}, 'incoming_message'); } catch(e){}
  }

  if (message.text && message.text.body) {
    const body = message.text.body.trim();
    const low = body.toLowerCase();

    // Redirection vers agent humain
    if (low === 'humain' || low === 'parlez à humain') {
      await sendText(from, "Un agent humain va prendre en charge votre demande. ⏳");
      if (ADMIN_PHONE) {
        await sendText(ADMIN_PHONE, `Nouvelle demande d'assistance de ${from}`);
      }
      return;
    }

    // Catalogue
    if (['catalogue','tarif','prix'].includes(low)) {
      const cat = await readCatalog();
      const lines = cat.map(i => `${i.N} - ${i.Désignation}: NE ${i.NE || '-'} | NS ${i.NS || '-'} | REP ${i.REP || '-'}`);
      await sendText(from, lines.join('\n'));
      return;
    }

    // Commande
    if (body.includes(',')) {
      const parts = body.split(',').map(p => p.trim());
      if (parts.length >= 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[2])) {
        const index = parseInt(parts[0],10);
        const priceType = parts[1].toUpperCase();
        const qty = parseInt(parts[2],10);
        try {
          const { total, breakdown, item } = await computePriceFromCatalogue(index, priceType, qty);
          if (process.env.MAKE_WEBHOOK_URL) {
            await sendToMakeWebhook({action:'create_order', phone: from, item, priceType, qty, total}, 'Orders');
            await sendText(from, `Récapitulatif: ${breakdown}\nTotal: ${total} FCFA\nRépondez 'oui' pour confirmer.`);
          } else {
            await sendText(from, `Récapitulatif: ${breakdown}\nTotal: ${total} FCFA\nCommande non enregistrée (Make non configuré).`);
          }
        } catch (err) {
          await sendText(from, 'Erreur: article ou type de tarif introuvable.');
        }
        return;
      }
    }

    // Message par défaut
    await sendText(from, "Bienvenue! Tapez 'catalogue', envoyez 'N, NE/NS/REP, qty' pour commander ou 'humain' pour parler à un agent.");
    return;
  }

  await sendText(from, 'Type de message non géré. Souhaitez-vous parler à un agent ? Tapez "humain".');
}

export { sendText, handleIncomingMessage };
