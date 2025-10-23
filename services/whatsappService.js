// src/services/whatsappService.js
import axios from 'axios';
import { computePriceFromCatalogue, readCatalog, addOrder } from './orderService.js';
import { sendToMakeWebhook } from './makeService.js';
import * as userService from './userService.js';
import * as pickupService from './pickupService.js';
import * as promoService from './promoService.js';
import * as humanService from './humanService.js';
import * as pointsService from './pointsService.js';
import * as notificationsService from './notificationsService.js';
import * as agentsService from './agentsService.js';

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const API_URL = PHONE_ID ? `https://graph.facebook.com/v17.0/${PHONE_ID}/messages` : null;

// Message d'accueil principal
const WELCOME_MESSAGE = `Bonjour 👋 et bienvenue chez Pressing Yamba 🧺
Je suis votre assistant virtuel. Voici nos services :

1️⃣ Lavage à sec
2️⃣ Lavage à eau
3️⃣ Repassage
4️⃣ Autres services
5️⃣ Parler à un agent humain 👩🏽‍💼

➡ Répondez avec un chiffre (1 à 5) pour choisir un service.
Tapez "*" à tout moment pour revenir à ce menu.`;

// ---------------------------
// Envoi simple de texte
// ---------------------------
async function sendText(to, text) {
  if (!TOKEN || !PHONE_ID) return false;
  try {
    const payload = { messaging_product: 'whatsapp', to, text: { body: text } };
    const res = await axios.post(API_URL, payload, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });
    // log local
    await notificationsService.logNotification(to, text);
    return res.status === 200 || res.status === 201;
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
    return false;
  }
}

// ---------------------------
// Envoi d'image avec texte
// ---------------------------
async function sendImage(to, imageUrl, caption) {
  if (!TOKEN || !PHONE_ID) return false;
  try {
    const payload = { messaging_product: 'whatsapp', to, type: 'image', image: { link: imageUrl, caption } };
    const res = await axios.post(API_URL, payload, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });
    await notificationsService.logNotification(to, caption, imageUrl);
    return res.status === 200 || res.status === 201;
  } catch (err) {
    console.error('WhatsApp send image error:', err.response?.data || err.message);
    return false;
  }
}

// ---------------------------
// Vérifie si un message d'accueil doit être envoyé (24h)
// ---------------------------
async function sendWelcomeIfNeeded(to) {
  const now = new Date();
  const lastMessageAt = await userService.getUserLastMessage(to);
  if (!lastMessageAt || (now - new Date(lastMessageAt)) > 24 * 60 * 60 * 1000) {
    await sendText(to, WELCOME_MESSAGE);
    await userService.updateUserLastMessage(to, now);
  }
}

// ---------------------------
// Gestion des messages entrants
// ---------------------------
async function handleIncomingMessage(message) {
  const from = message.from;
  if (!from) return;

  // Forward vers Make (event logging)
  if (process.env.MAKE_WEBHOOK_URL) {
    try { await sendToMakeWebhook({ incoming: message }, 'incoming_message'); } catch (e) { /* non bloquant */ }
  }

  const now = new Date();
  const lastMessageAt = await userService.getUserLastMessage(from);

  // Accueil automatique
  if (!lastMessageAt || (now - new Date(lastMessageAt)) > 24 * 60 * 60 * 1000) {
    await sendText(from, WELCOME_MESSAGE);
    await userService.updateUserLastMessage(from, now);
    return;
  }

  // Gestion menu principal et sous-menus
  if (message.text && message.text.body) {
    const body = message.text.body.trim();

    if (body === '*') {
      await sendText(from, WELCOME_MESSAGE);
      await userService.updateUserLastMessage(from, now);
      return;
    }

    switch (body) {
      case '1':
        await sendImage(from, 'https://exemple.com/lavage_sec.jpg', 'Voici les prix pour le lavage à sec.');
        await userService.updateUserState(from, { service: 'lavage_sec' });
        break;
      case '2':
        await sendImage(from, 'https://exemple.com/lavage_eau.jpg', 'Voici les prix pour le lavage à eau.');
        await userService.updateUserState(from, { service: 'lavage_eau' });
        break;
      case '3':
        await sendImage(from, 'https://exemple.com/repassage.jpg', 'Voici les prix pour le repassage.');
        await userService.updateUserState(from, { service: 'repassage' });
        break;
      case '4':
        await sendImage(from, 'https://exemple.com/autres_services.jpg', 'Services supplémentaires.');
        await userService.updateUserState(from, { service: 'autres_services' });
        break;
      case '5':
        await sendText(from, 'Merci ! 😊 Un membre de notre équipe va vous répondre.');
        const agent = await agentsService.assignAgent();
        if (agent) await sendText(agent.Phone, `Nouvelle demande d'assistance de ${from}`);
        await humanService.createHumanRequest(from);
        break;
      // sous-options attendues (client doit envoyer '1_dep' etc.)
      case '1_dep':
      case '2_pickup':
      case '1_oui':
      case '2_non':
        await handleSubMenuResponses(from, body);
        break;
      default:
        // Cas commande par syntaxe (ex: "12, NE, 2") -> support backward compatibility
        if (body.includes(',')) {
          const parts = body.split(',').map(p => p.trim());
          if (parts.length >= 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[2])) {
            const index = parseInt(parts[0], 10);
            const priceType = parts[1].toUpperCase();
            const qty = parseInt(parts[2], 10);
            try {
              const res = await computePriceFromCatalogue(index, priceType, qty);
              if (res?.status === 'ok') {
                await sendToMakeWebhook({ action:'create_order', phone: from, item: res.item, priceType, qty, total: res.total }, 'Orders');
                await sendText(from, `Récapitulatif: ${res.breakdown}\nTotal: ${res.total} FCFA\nRépondez 'oui' pour confirmer.`);
              } else {
                await sendText(from, `Erreur: ${res?.message || 'prix non disponible'}`);
              }
            } catch (err) {
              await sendText(from, 'Erreur lors du calcul du prix.');
            }
            await userService.updateUserLastMessage(from, now);
            return;
          }
        }

        await sendText(from, "Je n'ai pas compris votre choix. Tapez 1-5, '*' pour revenir ou envoyez 'N, NE/NS/REP, qty' pour commander.");
    }

    await userService.updateUserLastMessage(from, now);
    return;
  }

  await sendText(from, 'Type de message non géré. Tapez "*" pour revenir au menu.');
}

// ---------------------------
// Gestion sous-menus et création de commandes avec computePriceFromCatalogue
// ---------------------------
async function handleSubMenuResponses(from, choice) {
  const state = await userService.getUserState(from);
  if (!state?.service) {
    await sendText(from, "Erreur : aucun service sélectionné. Tapez '*' pour revenir au menu.");
    return;
  }

  // find a representative catalogue item for the chosen service
  const catalog = await readCatalog();
  // try to map service name to a catalogue item (best-effort)
  let catalogItem = catalog.find(i => (i.Service && i.Service.toLowerCase().includes(state.service.replace('_',' '))) || i.Désignation?.toLowerCase().includes(state.service.replace('_',' ')));
  if (!catalogItem) catalogItem = catalog[0]; // fallback

  const order = {
    ClientPhone: from,
    ItemsJSON: [],
    Total: 0,
    Status: 'Pending',
    CreatedAt: new Date().toISOString()
  };

  // build item descriptor to pass to computePriceFromCatalogue
  // computePriceFromCatalogue expects an index (N) or designation; we'll pass N
  const itemIndex = catalogItem?.N || catalogItem?.Désignation;

  switch (choice) {
    case '1_dep':
      order.ItemsJSON.push({ N: itemIndex, description: catalogItem.Désignation, option: 'Dépôt au pressing', priceType: 'NE', qty: 1 });
      break;
    case '2_pickup':
      order.ItemsJSON.push({ N: itemIndex, description: catalogItem.Désignation, option: 'Enlèvement à domicile', priceType: 'NE', qty: 1 });
      break;
    case '1_oui':
      // amidonnage: try to use AM price if present, else add fixed amidonnage cost
      order.ItemsJSON.push({ N: itemIndex, description: catalogItem.Désignation, option: 'Amidonnage', priceType: (catalogItem.AM ? 'AM' : 'NE'), qty: 1 });
      break;
    case '2_non':
      order.ItemsJSON.push({ N: itemIndex, description: catalogItem.Désignation, option: 'Sans amidonnage', priceType: 'NE', qty: 1 });
      break;
  }

  // calculate totals by calling computePriceFromCatalogue for each item
  let total = 0;
  const breakdowns = [];
  for (const it of order.ItemsJSON) {
    try {
      const res = await computePriceFromCatalogue(it.N, it.priceType, it.qty);
      if (res?.status === 'ok') {
        it.total = res.total;
        breakdowns.push(res.breakdown);
        total += res.total;
      } else {
        breakdowns.push(`Erreur pour ${it.description}: ${res?.message || 'prix indisponible'}`);
      }
    } catch (err) {
      console.warn('Erreur calcul prix:', err);
      breakdowns.push(`Erreur calcul prix pour ${it.description}`);
    }
  }

  order.Total = total;

  // persist order (through orderService.addOrder -> which will forward to Make/Sheets)
  if (typeof addOrder === 'function') {
    try { await addOrder(order); } catch (e) { console.warn('addOrder failed', e.message); }
  } else {
    // fallback: forward to Make directly
    if (process.env.MAKE_WEBHOOK_URL) {
      await sendToMakeWebhook({ event: 'create_order', payload: order }, 'Orders');
    }
  }

  // user feedback
  await sendText(from, `Commande enregistrée ✅\nDétails:\n${breakdowns.join('\n')}\nTotal estimé : ${order.Total} F`);

  // add loyalty points
  try { await pointsService.addPoints(from, Math.floor(order.Total / 100)); } catch (e) { console.warn('points add failed', e.message); }

  await userService.clearUserState(from);
}

// ---------------------------
// Export
// ---------------------------
export { sendText, sendImage, handleIncomingMessage, sendWelcomeIfNeeded };
