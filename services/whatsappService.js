// services/whatsappService.js
import axios from 'axios';
import { computePriceFromCatalogue, readCatalog } from './orderService.js';
import { sendToMakeWebhook } from './makeService.js';

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const ADMIN_PHONE = process.env.ADMIN_PHONE ? process.env.ADMIN_PHONE.replace(/[\s\-+]/g, '').replace(/^0+/, '') : null;
const API_URL = PHONE_ID ? `https://graph.facebook.com/v17.0/${PHONE_ID}/messages` : null;

/**
 * Basic send - text message
 */
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

/**
 * Send a structured welcome/menu (text fallback + buttons)
 * Using simple text menu and '0' as "revenir au menu"
 */
async function sendWelcomeMenu(to) {
  const text = `Bonjour 👋 et bienvenue chez Pressing Yamba 🧺\nJe suis votre assistant virtuel. Voici nos services :\n\n1️⃣ Lavage à sec\n2️⃣ Lavage à eau\n3️⃣ Repassage\n4️⃣ Autres services (amidonnage, enlèvement, livraison)\n5️⃣ Parler à un agent humain 👩🏽‍💼\n\n➡ Répondez par le chiffre (1 à 5). Tapez 0 pour revenir au menu à tout moment.`;
  return await sendText(to, text);
}

/**
 * Send service details (text + option to choose sub-action)
 * imagesId is optional (WhatsApp media id or URL) — here we send text; Make can send images if needed.
 */
async function sendServiceDetail(to, serviceKey) {
  const catalog = await readCatalog();
  // Hard-coded examples based on your spec, but catalogue can provide prices
  if (serviceKey === '1') {
    const txt = `Voici les prix pour le lavage à sec 👇\n🧺 Serviette : 900 F (NE) | Repassage : 300 F\n👔 Chemise : 1000 F | Costume : 3000 F\n\nSouhaitez-vous :\n1️⃣ Dépôt au pressing\n2️⃣ Enlèvement à domicile 🚚\n\nTapez 1 ou 2. Tapez 0 pour revenir au menu.`;
    return await sendText(to, txt);
  } else if (serviceKey === '2') {
    const txt = `Lavage à eau 💧\n🧺 Serviette : 700 F\n👕 T-shirt : 500 F\nDrap : 1000 F\n\nSouhaitez-vous un amidonnage ?\n1️⃣ Oui\n2️⃣ Non\n\nTapez 0 pour revenir au menu.`;
    return await sendText(to, txt);
  } else if (serviceKey === '3') {
    const txt = `Voici nos tarifs pour le repassage 👕\n\nChemise : 300 F\nPantalon : 400 F\nCostume : 800 F\n\nTapez 0 pour revenir au menu.`;
    return await sendText(to, txt);
  } else if (serviceKey === '4') {
    const txt = `Services supplémentaires 🌟\n\nAmidonnage : 200 F par vêtement\nEnlèvement à domicile 🚚\nLivraison après nettoyage 📦\n\nTapez 0 pour revenir au menu.`;
    return await sendText(to, txt);
  } else if (serviceKey === '5') {
    const txt = `Merci ! 😊\nUn membre de notre équipe va vous répondre dans quelques instants.`;
    // notify admin
    if (ADMIN_PHONE) {
      await sendText(ADMIN_PHONE, `Nouvelle demande d'assistance de ${to}`);
    }
    return await sendText(to, txt);
  } else {
    return await sendText(to, "Option inconnue. Tapez 0 pour revenir au menu.");
  }
}

/**
 * Handle incoming message object from WhatsApp
 */
async function handleIncomingMessage(message) {
  const from = message.from;
  if (!from) return;

  // forward raw incoming to Make (best-effort)
  if (process.env.MAKE_WEBHOOK_URL) {
    try {
      await sendToMakeWebhook({ incoming: message }, 'incoming_message');
    } catch (e) {
      // do not block execution on Make failure
    }
  }

  // 1) Handle location messages first
  if (message.location) {
    const { latitude, longitude, address } = message.location;
    if (process.env.MAKE_WEBHOOK_URL) {
      try {
        await sendToMakeWebhook({ action: 'create_pickup', phone: from, lat: latitude, lon: longitude, address }, 'create_pickup');
        await sendText(from, `Localisation reçue ✅. Nous organiserons l'enlèvement.`);
      } catch (e) {
        await sendText(from, `Make non configuré : impossible d'enregistrer l'enlèvement.`);
      }
    } else {
      await sendText(from, `Make non configuré : impossible d'enregistrer l'enlèvement.`);
    }
    return;
  }

  // 2) Determine user last_message_ts and state via Make (so persistence in Google Sheets)
  let userRecord = null;
  try {
    const res = await sendToMakeWebhook({ action: 'get_user', phone: from }, 'get_user');
    // Expecting Make to return { user: { phone, name, last_message_ts, state } } or { user: null }
    userRecord = res?.user || null;
  } catch (e) {
    console.warn('get_user failed:', e.message);
  }

  const now = new Date();
  const lastTs = userRecord?.last_message_ts ? new Date(userRecord.last_message_ts) : null;
  const hoursSinceLast = lastTs ? (now - lastTs) / (1000 * 60 * 60) : Infinity;

  // If first message after >=24h -> send welcome menu and update last_message_ts & state
  if (!lastTs || hoursSinceLast >= 24) {
    await sendWelcomeMenu(from);
    // update user last_message_ts and state = 'menu' in Make
    try {
      await sendToMakeWebhook({ action: 'update_user', phone: from, data: { last_message_ts: now.toISOString(), state: 'menu' } }, 'update_user');
    } catch (e) {
      console.warn('update_user failed:', e.message);
    }
    return;
  }

  // If here user is within 24h window -> handle according to incoming text and state
  if (message.text && message.text.body) {
    const body = message.text.body.trim();
    const low = body.toLowerCase();

    // Always allow '0' or 'menu' to return to main menu
    if (low === '0' || low === 'menu' || low === 'accueil') {
      await sendWelcomeMenu(from);
      try {
        await sendToMakeWebhook({ action: 'update_user', phone: from, data: { state: 'menu', last_message_ts: now.toISOString() } }, 'update_user');
      } catch (e) { }
      return;
    }

    // redirect to human
    if (low === 'humain' || low.includes('agent') || low.includes('parlez à un agent')) {
      await sendText(from, "Un agent humain va prendre en charge votre demande. ⏳");
      if (ADMIN_PHONE) {
        await sendText(ADMIN_PHONE, `Nouvelle demande d'assistance de ${from}`);
      }
      // update state
      try {
        await sendToMakeWebhook({ action: 'update_user', phone: from, data: { state: 'wait_agent', last_message_ts: now.toISOString() } }, 'update_user');
      } catch (e) {}
      return;
    }

    // If user typed a single digit 1-5 -> show detailed service
    if (/^[1-5]$/.test(body)) {
      await sendServiceDetail(from, body);
      try {
        await sendToMakeWebhook({ action: 'update_user', phone: from, data: { state: `service_${body}`, last_message_ts: now.toISOString() } }, 'update_user');
      } catch (e) {}
      return;
    }

    // If message looks like an order: ex: "1, NE, 2" or "Chemise, NE, 3"
    if (body.includes(',') && body.split(',').length >= 3) {
      const parts = body.split(',').map(p => p.trim());
      const index = parts[0];
      const priceType = parts[1].toUpperCase();
      const qty = parts[2];
      if (/^\d+$/.test(qty) && qty > 0) {
        try {
          const { total, breakdown, item } = await computePriceFromCatalogue(index, priceType, qty);
          // Save order via Make (Google Sheets) with minimal fields
          const orderPayload = {
            phone: from,
            name: userRecord?.name || '',
            serviceRef: item?.N || item?.Désignation || index,
            priceType,
            qty: Number(qty),
            estimated_total: total,
            ts: now.toISOString()
          };
          if (process.env.MAKE_WEBHOOK_URL) {
            try {
              await sendToMakeWebhook({ action: 'create_order', order: orderPayload }, 'create_order');
              await sendText(from, `Récapitulatif: ${breakdown}\nTotal: ${total} FCFA\nRépondez 'oui' pour confirmer.`);
              // update user state
              await sendToMakeWebhook({ action: 'update_user', phone: from, data: { state: 'awaiting_confirmation', last_message_ts: now.toISOString() } }, 'update_user');
            } catch (e) {
              // fallback: inform user
              await sendText(from, `Récapitulatif: ${breakdown}\nTotal: ${total} FCFA\nCommande non enregistrée (Make non configuré).`);
            }
          } else {
            await sendText(from, `Récapitulatif: ${breakdown}\nTotal: ${total} FCFA\nCommande non enregistrée (Make non configuré).`);
          }
        } catch (err) {
          await sendText(from, 'Erreur: article ou type de tarif introuvable. Vérifiez le numéro et le type (NE/NS/REP).');
        }
        return;
      }
    }

    // If awaiting confirmation and user replies 'oui' or 'non'
    if (userRecord?.state === 'awaiting_confirmation') {
      if (low === 'oui' || low === 'o' || low === 'yes') {
        // Ask Make to confirm order (Make will update the Google Sheet row)
        try {
          await sendToMakeWebhook({ action: 'confirm_last_order', phone: from }, 'confirm_last_order');
          await sendText(from, "Merci ✅. Votre commande est enregistrée. Nous vous contacterons pour l'enlèvement/livraison.");
          await sendToMakeWebhook({ action: 'update_user', phone: from, data: { state: 'order_confirmed', last_message_ts: now.toISOString() } }, 'update_user');
        } catch (e) {
          await sendText(from, "Erreur lors de l'enregistrement. Veuillez réessayer plus tard.");
        }
      } else if (low === 'non') {
        await sendText(from, "Commande annulée. Tapez 0 pour revenir au menu.");
        await sendToMakeWebhook({ action: 'update_user', phone: from, data: { state: 'menu', last_message_ts: now.toISOString() } }, 'update_user');
      } else {
        await sendText(from, "Répondez 'oui' pour confirmer la commande ou 'non' pour annuler.");
      }
      return;
    }

    // Default reply within 24h (help)
    await sendText(from, "Bienvenue! Tapez 'catalogue' pour voir la liste, envoyez 'N, NE/NS/REP, qty' pour commander, 'humain' pour parler à un agent, ou 0 pour le menu.");
    // update last_message_ts
    try {
      await sendToMakeWebhook({ action: 'update_user', phone: from, data: { last_message_ts: now.toISOString() } }, 'update_user');
    } catch (e) {}
    return;
  }

  // Non-text messages fallback
  await sendText(from, 'Type de message non géré. Souhaitez-vous parler à un agent ? Tapez "humain".');
  try {
    await sendToMakeWebhook({ action: 'update_user', phone: from, data: { last_message_ts: now.toISOString() } }, 'update_user');
  } catch (e) {}
}
export { sendText, handleIncomingMessage };
