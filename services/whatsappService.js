// src/services/whatsappService.js
import axios from 'axios';
import { computePriceFromCatalogue, readCatalog, addOrder } from './orderService.js';
import { sendToMakeWebhook } from './makeService.js';
import * as userService from './userService.js';
import * as pointsService from './pointsService.js';
import * as notificationsService from './notificationsService.js';
import * as agentsService from './agentsService.js';
import * as humanService from './humanService.js';

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;

// ---------------------------
// Messages principaux
// ---------------------------
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
// Envoi texte
// ---------------------------
export async function sendWhatsAppMessage(to, text) {
  if (!TOKEN || !PHONE_ID) return false;
  try {
    const payload = { messaging_product: 'whatsapp', to, text: { body: text } };
    await axios.post(WHATSAPP_API_URL, payload, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    });
    await notificationsService.logNotification(to, text);
    return true;
  } catch (err) {
    console.error('Erreur envoi message WhatsApp :', err.response?.data || err.message);
    return false;
  }
}

// ---------------------------
// Envoi image
// ---------------------------
export async function sendWhatsAppImage(to, imageUrl, caption) {
  if (!TOKEN || !PHONE_ID) return false;
  try {
    const payload = { messaging_product: 'whatsapp', to, type: 'image', image: { link: imageUrl, caption } };
    await axios.post(WHATSAPP_API_URL, payload, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    });
    await notificationsService.logNotification(to, caption, imageUrl);
    return true;
  } catch (err) {
    console.error('Erreur envoi image WhatsApp :', err.response?.data || err.message);
    return false;
  }
}

// ---------------------------
// Envoi message d'accueil si nécessaire (24h) ou forcé
// ---------------------------
export async function sendWelcomeIfNeeded(to, force = false) {
  const now = new Date();
  const lastMessageAt = await userService.getUserLastMessage(to);
  if (force || !lastMessageAt || (now - new Date(lastMessageAt)) > 24 * 60 * 60 * 1000) {
    await sendWhatsAppMessage(to, WELCOME_MESSAGE);
    await userService.updateUserLastMessage(to, now);
  }
}

// ---------------------------
// Gestion des sous-menus
// ---------------------------
async function handleSubMenuResponses(from, choice) {
  const state = await userService.getUserState(from);
  if (!state?.service) {
    await sendWhatsAppMessage(from, "Erreur : aucun service sélectionné. Tapez '*' pour revenir au menu.");
    return;
  }

  const catalog = await readCatalog();
  let catalogItem = catalog.find(
    i => (i.Service && i.Service.toLowerCase().includes(state.service.replace('_',' '))) || 
         i.Désignation?.toLowerCase().includes(state.service.replace('_',' '))
  );
  if (!catalogItem) catalogItem = catalog[0];

  const order = { ClientPhone: from, ItemsJSON: [], Total: 0, Status: 'Pending', CreatedAt: new Date().toISOString() };
  const itemIndex = catalogItem?.N || catalogItem?.Désignation;

  switch (choice) {
    case '1_dep': order.ItemsJSON.push({ N: itemIndex, description: catalogItem.Désignation, option: 'Dépôt au pressing', priceType: 'NE', qty: 1 }); break;
    case '2_pickup': order.ItemsJSON.push({ N: itemIndex, description: catalogItem.Désignation, option: 'Enlèvement à domicile', priceType: 'NE', qty: 1 }); break;
    case '1_oui': order.ItemsJSON.push({ N: itemIndex, description: catalogItem.Désignation, option: 'Amidonnage', priceType: (catalogItem.AM ? 'AM' : 'NE'), qty: 1 }); break;
    case '2_non': order.ItemsJSON.push({ N: itemIndex, description: catalogItem.Désignation, option: 'Sans amidonnage', priceType: 'NE', qty: 1 }); break;
  }

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

  try {
    await addOrder(order);
  } catch (e) {
    console.warn('addOrder failed', e.message);
    if (process.env.MAKE_WEBHOOK_URL) await sendToMakeWebhook({ event: 'create_order', payload: order }, 'Orders');
  }

  await sendWhatsAppMessage(from, `Commande enregistrée ✅\nDétails:\n${breakdowns.join('\n')}\nTotal estimé : ${order.Total} F`);

  try { await pointsService.addPoints(from, Math.floor(order.Total / 100)); } catch (e) { console.warn('points add failed', e.message); }

  await userService.clearUserState(from);
}

// ---------------------------
// Gestion des messages entrants
// ---------------------------
export async function handleIncomingMessage(message) {
  const from = message.from;
  if (!from) return;
  const body = (message.text?.body || '').trim().toLowerCase();

  // 🔄 Forward vers Make (si configuré)
  if (process.env.MAKE_WEBHOOK_URL) {
    try { await sendToMakeWebhook({ incoming: message }, 'incoming_message'); } catch (e) { }
  }

  const now = new Date();

  // ✅ Accueil automatique (toujours déclenché si message * ou force)
  if (body === '*') {
    await sendWelcomeIfNeeded(from, true);
    return;
  }

  const lastMessageAt = await userService.getUserLastMessage(from);
  if (!lastMessageAt || (now - new Date(lastMessageAt)) > 24 * 60 * 60 * 1000) {
    await sendWelcomeIfNeeded(from);
    return;
  }

  // 🔹 Sous-menus
  if (['1_dep','2_pickup','1_oui','2_non'].includes(body)) {
    await handleSubMenuResponses(from, body);
    await userService.updateUserLastMessage(from, now);
    return;
  }

  // 🔹 Menu principal
  switch (body) {
    case '1': await sendWhatsAppImage(from, 'https://exemple.com/lavage_sec.jpg', 'Voici les prix pour le lavage à sec.'); await userService.updateUserState(from, { service: 'lavage_sec' }); break;
    case '2': await sendWhatsAppImage(from, 'https://exemple.com/lavage_eau.jpg', 'Voici les prix pour le lavage à eau.'); await userService.updateUserState(from, { service: 'lavage_eau' }); break;
    case '3': await sendWhatsAppImage(from, 'https://exemple.com/repassage.jpg', 'Voici les prix pour le repassage.'); await userService.updateUserState(from, { service: 'repassage' }); break;
    case '4': await sendWhatsAppImage(from, 'https://exemple.com/autres_services.jpg', 'Services supplémentaires.'); await userService.updateUserState(from, { service: 'autres_services' }); break;
    case '5':
      await sendWhatsAppMessage(from, 'Merci ! 😊 Un membre de notre équipe va vous répondre.');
      const agent = await agentsService.assignAgent();
      if (agent) await sendWhatsAppMessage(agent.Phone, `Nouvelle demande d'assistance de ${from}`);
      await humanService.createHumanRequest(from);
      break;
    default: break;
  }

  // 🔹 Commandes complexes
  if (body.includes(',')) {
    const parts = body.split(',').map(p => p.trim());
    if (parts.length >= 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[2])) {
      const index = parseInt(parts[0], 10);
      const priceType = parts[1].toUpperCase();
      const qty = parseInt(parts[2], 10);
      try {
        const res = await computePriceFromCatalogue(index, priceType, qty);
        if (res?.status === 'ok') {
          const order = { ClientPhone: from, ItemsJSON: [{ N: index, description: res.item, option: 'Commande', priceType, qty }], Total: res.total };
          await addOrder(order);
          await sendWhatsAppMessage(from, `🧾 Récapitulatif: ${res.breakdown}\nTotal: ${res.total} FCFA\nRépondez 'oui' pour confirmer.`);
        } else {
          await sendWhatsAppMessage(from, `Erreur: ${res?.message || 'prix non disponible'}`);
        }
      } catch (err) { await sendWhatsAppMessage(from, 'Erreur lors du calcul du prix.'); }
      await userService.updateUserLastMessage(from, now);
      return;
    }
  }

  // 🔹 Réponse par défaut
  await sendWhatsAppMessage(from, "Je n'ai pas compris votre choix. Tapez 1-5, '*' pour revenir ou envoyez 'N, NE/NS/REP, qty' pour commander.");
  await userService.updateUserLastMessage(from, now);
}
