import axios from 'axios';
import crypto from 'crypto';
import { computePriceFromCatalogue, addOrder } from './orderService.js';
import { sendToMakeWebhook } from './makeService.js';
import * as userService from './userService.js';
import * as pointsService from './pointsService.js';
import * as notificationsService from './notificationsService.js';
import * as agentsService from './agentsService.js';
import * as humanService from './humanService.js';
import * as pickupService from './pickupService.js';
import * as feedbackService from './feedbackService.js';

// ✅ Variables d’environnement
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;

if (!TOKEN || !PHONE_ID) {
  console.warn('[WhatsApp] ⚠️ Vérifiez les variables WHATSAPP_TOKEN et WHATSAPP_PHONE_ID.');
}

// ✅ Message d’accueil
const WELCOME_MESSAGE = `Bonjour 👋 et bienvenue chez Pressing Yamba 🧺
Je suis votre assistant virtuel. Voici nos services :
1️⃣ Lavage à sec
2️⃣ Lavage à eau
3️⃣ Repassage
4️⃣ Autres services
5️⃣ Parler à un agent humain 👩🏽‍💼

➡ Répondez avec un chiffre (1 à 5) pour choisir un service.
Tapez "*" à tout moment pour revenir à ce menu.
💬 Tapez "avis <note 1-5> <commentaire>" pour laisser un avis à tout moment.`;

// ---------------------------
// 🔒 Vérification de la signature Meta (X-Hub-Signature-256) du webhook WhatsApp
// ---------------------------
export function validateMetaWebhookSignature(headers, rawBody, secret = process.env.WHATSAPP_APP_SECRET) {
  if (!secret) {
    console.error('[Webhook] ❌ WHATSAPP_APP_SECRET non configuré — requête refusée par défaut.');
    return false;
  }

  const signatureHeader = headers['x-hub-signature-256'];
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    console.warn('[Webhook] ⚠️ Signature Meta absente ou mal formée.');
    return false;
  }

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ✅ Envoi message texte
export async function sendWhatsAppMessage(to, text) {
  if (!TOKEN || !PHONE_ID) {
    console.error('[WhatsApp] Token ou Phone ID manquant.');
    return false;
  }

  if (!to || !text) {
    console.warn('[WhatsApp] ⚠️ Paramètres manquants pour envoyer le message.');
    return false;
  }

  try {
    const payload = { messaging_product: 'whatsapp', to, text: { body: text } };
    await axios.post(WHATSAPP_API_URL, payload, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    });
    await notificationsService.logNotification(to, text);
    console.info(`[WhatsApp] ✅ Message envoyé à ${to}`);
    return true;
  } catch (err) {
    console.error('[WhatsApp] ❌ Erreur envoi message :', err.response?.data || err.message);
    return false;
  }
}

// ✅ Envoi d’image
export async function sendWhatsAppImage(to, imageUrl, caption) {
  if (!TOKEN || !PHONE_ID) {
    console.error('[WhatsApp] Token ou Phone ID manquant.');
    return false;
  }

  if (!to || !imageUrl) {
    console.warn('[WhatsApp] ⚠️ Paramètres manquants pour envoyer l’image.');
    return false;
  }

  try {
    const payload = { messaging_product: 'whatsapp', to, type: 'image', image: { link: imageUrl, caption } };
    await axios.post(WHATSAPP_API_URL, payload, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    });
    await notificationsService.logNotification(to, caption, imageUrl);
    console.info(`[WhatsApp] ✅ Image envoyée à ${to}`);
    return true;
  } catch (err) {
    console.error('[WhatsApp] ❌ Erreur envoi image :', err.response?.data || err.message);
    return false;
  }
}


// ✅ Sélection de l'article après le choix d'un service (1/2/3)
// state.priceType a été fixé par le menu principal (NS = lavage à sec, NE = lavage à eau, REP = repassage)
async function handleItemSelection(from, state, body) {
  const parts = body.split(',').map(p => p.trim());
  const itemNumber = parseInt(parts[0], 10);
  const qty = parts[1] ? parseInt(parts[1], 10) : 1;

  if (!itemNumber || !qty || qty <= 0) {
    await sendWhatsAppMessage(from, "Format invalide. Envoyez le numéro de l'article, éventuellement suivi de la quantité (ex: 8 ou 8,2).");
    return;
  }

  const res = await computePriceFromCatalogue(itemNumber, state.priceType, qty);
  if (res?.status !== 'ok') {
    await sendWhatsAppMessage(
      from,
      `Article introuvable ou prix indisponible pour ce service (${res?.message || 'erreur'}). Vérifiez le numéro dans le catalogue et réessayez.`
    );
    return;
  }

  await userService.saveUserState(from, {
    pendingItem: {
      itemNumber,
      qty,
      priceType: state.priceType,
      description: res.item.Désignation,
      breakdown: res.breakdown,
      total: res.total,
    },
  });

  await sendWhatsAppMessage(
    from,
    `🧾 ${res.breakdown}\nTotal : ${res.total} FCFA\n\nComment souhaitez-vous procéder ?\n1️⃣ Dépôt au pressing → répondez "1_dep"\n2️⃣ Enlèvement à domicile → répondez "2_pickup"`
  );
}

// ✅ Gestion des sous-menus (finalise la commande de l'article en attente)
async function handleSubMenuResponses(from, choice) {
  const state = await userService.getUserState(from);
  const pending = state?.pendingItem;

  if (!pending) {
    await sendWhatsAppMessage(from, "Aucun article en attente de confirmation. Tapez '*' pour revenir au menu, choisissez un service puis indiquez le numéro de l'article.");
    return;
  }

  const optionLabel =
    choice === '1_dep' ? 'Dépôt au pressing' :
    choice === '2_pickup' ? 'Enlèvement à domicile' :
    choice === '1_oui' ? 'Avec amidonnage' :
    'Sans amidonnage';

  const order = {
    ClientPhone: from,
    ItemsJSON: [{
      N: pending.itemNumber,
      description: pending.description,
      option: optionLabel,
      priceType: pending.priceType,
      qty: pending.qty,
      total: pending.total,
    }],
    Total: pending.total,
    Status: 'Pending',
    CreatedAt: new Date().toISOString(),
  };

  try {
    await addOrder(order);
  } catch (e) {
    console.warn('[WhatsApp] ⚠️ Échec ajout commande:', e.message);
    if (process.env.MAKE_WEBHOOK_URL) await sendToMakeWebhook({ event: 'create_order', payload: order }, 'Orders');
  }

  await sendWhatsAppMessage(from, `Commande enregistrée ✅\n${pending.breakdown}\nOption : ${optionLabel}\nTotal : ${order.Total} F`);

  if (choice === '2_pickup') {
    try {
      const pickupMsg = await pickupService.handlePickupRequest(from);
      await sendWhatsAppMessage(from, pickupMsg);
    } catch (e) {
      console.warn('[WhatsApp] ⚠️ Échec de la confirmation de ramassage :', e.message);
    }
  }

  try {
    await pointsService.addPoints(from, Math.floor(order.Total / 100));
  } catch (e) {
    console.warn('[WhatsApp] ⚠️ Ajout de points échoué :', e.message);
  }

  await userService.clearUserState(from);
}

// ✅ Gestion des messages entrants
export async function handleIncomingMessage(message) {
  const from = message.from;
  if (!from) return;

  const body = (message.text?.body || '').trim().toLowerCase();

  // ✅ Envoi du log vers Make
  if (process.env.MAKE_WEBHOOK_URL) {
    try {
      await sendToMakeWebhook({ incoming: message }, 'incoming_message');
      console.info('[Make] ✅ Message entrant envoyé à Make.');
    } catch {
      console.warn('[Make] ⚠️ Envoi du message entrant échoué.');
    }
  }

  const now = new Date();
  const lastMessageAt = await userService.getUserLastMessage(from);

  // ✅ Message d’accueil après 24h
  if (!lastMessageAt || now - new Date(lastMessageAt) > 24 * 60 * 60 * 1000) {
    await sendWhatsAppMessage(from, WELCOME_MESSAGE);
    await userService.updateUserLastMessage(from, now);
    return;
  }

  // ✅ Retour au menu
  if (body === '*') {
    await sendWhatsAppMessage(from, WELCOME_MESSAGE);
    await userService.updateUserLastMessage(from, now);
    return;
  }

  // ✅ Avis client (disponible à tout moment)
  if (/^avis\b/i.test(body)) {
    const match = body.match(/^avis\s+([1-5])\s*(.*)$/i);
    if (!match) {
      await sendWhatsAppMessage(from, 'Pour laisser un avis, écrivez : avis <note de 1 à 5> <votre commentaire>. Exemple : avis 5 Très bon service !');
    } else {
      const rating = parseInt(match[1], 10);
      const comment = match[2]?.trim() || `Note ${rating}/5`;
      const ok = await feedbackService.logFeedback(from, comment, rating);
      await sendWhatsAppMessage(from, ok ? 'Merci pour votre avis ! 🙏' : 'Une erreur est survenue, veuillez réessayer plus tard.');
    }
    await userService.updateUserLastMessage(from, now);
    return;
  }

  // ✅ Sous-menus (finalisation de l'article en attente)
  if (['1_dep', '2_pickup', '1_oui', '2_non'].includes(body)) {
    await handleSubMenuResponses(from, body);
    await userService.updateUserLastMessage(from, now);
    return;
  }

  const state = await userService.getUserState(from);

  // ✅ Sélection d'un article de catalogue après avoir choisi un service (1/2/3)
  if (state?.priceType && /^\d+(\s*,\s*\d+)?$/.test(body)) {
    await handleItemSelection(from, state, body);
    await userService.updateUserLastMessage(from, now);
    return;
  }

  // ✅ Menu principal
  switch (body) {
    case '1':
      await sendWhatsAppImage(from, 'https://exemple.com/lavage_sec.jpg', 'Voici les prix pour le lavage à sec.');
      await userService.updateUserState(from, { service: 'lavage_sec', priceType: 'NS' });
      await sendWhatsAppMessage(from, "Indiquez le numéro de l'article du catalogue et la quantité (ex: 8,2).");
      await userService.updateUserLastMessage(from, now);
      return;
    case '2':
      await sendWhatsAppImage(from, 'https://exemple.com/lavage_eau.jpg', 'Voici les prix pour le lavage à eau.');
      await userService.updateUserState(from, { service: 'lavage_eau', priceType: 'NE' });
      await sendWhatsAppMessage(from, "Indiquez le numéro de l'article du catalogue et la quantité (ex: 8,2).");
      await userService.updateUserLastMessage(from, now);
      return;
    case '3':
      await sendWhatsAppImage(from, 'https://exemple.com/repassage.jpg', 'Voici les prix pour le repassage.');
      await userService.updateUserState(from, { service: 'repassage', priceType: 'REP' });
      await sendWhatsAppMessage(from, "Indiquez le numéro de l'article du catalogue et la quantité (ex: 8,2).");
      await userService.updateUserLastMessage(from, now);
      return;
    case '4':
      await sendWhatsAppImage(from, 'https://exemple.com/autres_services.jpg', 'Services supplémentaires.');
      await userService.updateUserState(from, { service: 'autres_services' });
      await sendWhatsAppMessage(from, "Envoyez : numéro de l'article, type (NE/NS/REP), quantité. Exemple : 13,NE,1");
      await userService.updateUserLastMessage(from, now);
      return;
    case '5': {
      await sendWhatsAppMessage(from, 'Merci ! 😊 Un membre de notre équipe va vous répondre.');
      const agent = await agentsService.assignAgent();
      if (agent) await sendWhatsAppMessage(agent.Phone, `Nouvelle demande d’assistance de ${from}`);
      await humanService.escalateToHuman(from);
      await userService.updateUserLastMessage(from, now);
      return;
    }
    default:
      break;
  }

  // ✅ Commandes complexes
  if (body.includes(',')) {
    const parts = body.split(',').map(p => p.trim());
    if (parts.length >= 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[2])) {
      const index = parseInt(parts[0], 10);
      const priceType = parts[1].toUpperCase();
      const qty = parseInt(parts[2], 10);
      try {
        const res = await computePriceFromCatalogue(index, priceType, qty);
        if (res?.status === 'ok') {
          const order = {
            ClientPhone: from,
            ItemsJSON: [{ N: index, description: res.item, option: 'Commande', priceType, qty }],
            Total: res.total,
          };
          await addOrder(order);
          await sendWhatsAppMessage(from, `🧾 Récapitulatif : ${res.breakdown}\nTotal : ${res.total} FCFA\nRépondez 'oui' pour confirmer.`);
        } else {
          await sendWhatsAppMessage(from, `Erreur : ${res?.message || 'prix non disponible'}`);
        }
      } catch {
        await sendWhatsAppMessage(from, 'Erreur lors du calcul du prix.');
      }
      await userService.updateUserLastMessage(from, now);
      return;
    }
  }

  // ✅ Réponse par défaut
  await sendWhatsAppMessage(from, "Je n’ai pas compris votre choix. Tapez 1-5, '*' pour revenir, ou envoyez 'N, NE/NS/REP, qty' pour commander.");
  await userService.updateUserLastMessage(from, now);
}
