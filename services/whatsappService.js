import axios from 'axios';
import crypto from 'crypto';
import { computePriceFromCatalogue, addOrder, readCatalog } from './orderService.js';
import { sendToMakeWebhook } from './makeService.js';
import * as userService from './userService.js';
import * as pointsService from './pointsService.js';
import * as notificationsService from './notificationsService.js';
import * as agentsService from './agentsService.js';
import * as humanService from './humanService.js';
import * as pickupService from './pickupService.js';
import * as feedbackService from './feedbackService.js';

const AMIDONNAGE_PRICE = 1000;

// Ordre d'affichage des catégories + identifiants courts (slugs) utilisés dans les
// id des listes interactives WhatsApp (doivent rester en minuscules, sans accents/slash)
const CATEGORY_SLUGS = [
  ['Haut', 'haut'],
  ['Bas', 'bas'],
  ['Ensemble/Robe', 'ensemble'],
  ['Costume/Veste', 'costume'],
  ['Drap/Grand', 'drap'],
  ['Autre', 'autre'],
];
const SLUG_TO_CATEGORY = Object.fromEntries(CATEGORY_SLUGS.map(([cat, slug]) => [slug, cat]));

const PRICE_LABELS = { NE: 'Lavage à eau', NS: 'Lavage à sec', REP: 'Repassage', AM: 'Amidonnage' };
const ITEM_LIST_PAGE_SIZE = 9; // laisse une place pour la ligne "page suivante" (max 10 lignes/message)

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
4️⃣ Amidonnage (seul)
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


// ✅ Envoi d'une liste interactive WhatsApp (menu déroulant natif)
async function sendWhatsAppInteractiveList(to, { body, header, footer, buttonText, sections }) {
  if (!TOKEN || !PHONE_ID) {
    console.error('[WhatsApp] Token ou Phone ID manquant.');
    return false;
  }

  try {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(header ? { header: { type: 'text', text: header } } : {}),
        body: { text: body },
        ...(footer ? { footer: { text: footer } } : {}),
        action: { button: buttonText, sections },
      },
    };
    await axios.post(WHATSAPP_API_URL, payload, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    });
    await notificationsService.logNotification(to, body);
    console.info(`[WhatsApp] ✅ Liste interactive envoyée à ${to}`);
    return true;
  } catch (err) {
    console.error('[WhatsApp] ❌ Erreur envoi liste interactive :', err.response?.data || err.message);
    return false;
  }
}

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return `${str.slice(0, max - 1)}…`;
}

// ✅ Étape 1 : liste des catégories disponibles pour le type de prix choisi (NE/NS/REP/AM)
async function sendCategoryList(to, priceType) {
  const items = await readCatalog();
  const counts = {};
  for (const item of items) {
    if (Number(item[priceType]) > 0) counts[item.Catégorie] = (counts[item.Catégorie] || 0) + 1;
  }

  const rows = CATEGORY_SLUGS
    .filter(([cat]) => counts[cat] > 0)
    .map(([cat, slug]) => ({
      id: `cat_${slug}`,
      title: truncate(cat, 24),
      description: `${counts[cat]} article(s) disponible(s)`,
    }));

  if (rows.length === 0) {
    await sendWhatsAppMessage(to, "Aucun article disponible pour ce service pour le moment.");
    return;
  }

  await sendWhatsAppInteractiveList(to, {
    body: `📖 ${PRICE_LABELS[priceType] || priceType} — Choisissez une catégorie d'articles :`,
    buttonText: 'Catégories',
    sections: [{ title: 'Catégories', rows }],
  });
}

// ✅ Étape 2 : liste des articles d'une catégorie (paginée par 9, avec une ligne "page suivante")
async function sendItemList(to, category, priceType, page = 0) {
  const all = (await readCatalog()).filter((i) => i.Catégorie === category && Number(i[priceType]) > 0);
  const start = page * ITEM_LIST_PAGE_SIZE;
  const pageItems = all.slice(start, start + ITEM_LIST_PAGE_SIZE);
  const hasNext = start + ITEM_LIST_PAGE_SIZE < all.length;

  if (pageItems.length === 0) {
    await sendWhatsAppMessage(to, "Aucun article trouvé dans cette catégorie. Tapez '*' pour revenir au menu.");
    return;
  }

  const slug = CATEGORY_SLUGS.find(([cat]) => cat === category)?.[1] || 'autre';
  const rows = pageItems.map((i) => ({
    id: `item_${i.N}`,
    title: truncate(`${i.N}. ${i.Désignation}`, 24),
    description: truncate(`${i.Désignation} — ${i[priceType]} FCFA`, 72),
  }));

  if (hasNext) {
    rows.push({
      id: `catpage_${slug}_${page + 1}`,
      title: '➡️ Page suivante',
      description: `Voir plus d'articles (${category})`,
    });
  }

  await sendWhatsAppInteractiveList(to, {
    body: `📦 ${category}${page > 0 ? ` (page ${page + 1})` : ''} — Sélectionnez un article :`,
    buttonText: 'Articles',
    sections: [{ title: truncate(category, 24), rows }],
  });
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

  // Service 4 (amidonnage) est déjà lui-même le service d'amidonnage : pas de question
  // d'ajout d'amidonnage à poser, on passe directement au choix dépôt/enlèvement.
  const isAmidonnageOnly = state.service === 'amidonnage';

  await userService.saveUserState(from, {
    pendingItem: {
      itemNumber,
      qty,
      priceType: state.priceType,
      description: res.item.Désignation,
      breakdown: res.breakdown,
      total: res.total,
      isAmidonnageOnly,
    },
  });

  if (isAmidonnageOnly) {
    await sendWhatsAppMessage(
      from,
      `🧾 ${res.breakdown}\nTotal : ${res.total} FCFA\n\nComment souhaitez-vous procéder ?\n1️⃣ Dépôt au pressing → répondez "1_dep"\n2️⃣ Enlèvement à domicile → répondez "2_pickup"`
    );
  } else {
    await sendWhatsAppMessage(
      from,
      `🧾 ${res.breakdown}\nTotal : ${res.total} FCFA\n\nSouhaitez-vous ajouter l'amidonnage pour cet article (+${AMIDONNAGE_PRICE} FCFA) ?\n1️⃣ Oui → répondez "1_oui"\n2️⃣ Non → répondez "2_non"`
    );
  }
}

// ✅ Gestion des sous-menus (finalise la commande de l'article en attente)
async function handleSubMenuResponses(from, choice) {
  const state = await userService.getUserState(from);
  const pending = state?.pendingItem;

  if (!pending) {
    await sendWhatsAppMessage(from, "Aucun article en attente de confirmation. Tapez '*' pour revenir au menu, choisissez un service puis indiquez le numéro de l'article.");
    return;
  }

  // Étape 1/2 (uniquement pour les services 1/2/3) : décision amidonnage avant le choix dépôt/enlèvement
  if (choice === '1_oui' || choice === '2_non') {
    if (pending.isAmidonnageOnly) {
      await sendWhatsAppMessage(from, `Réponse inattendue. Répondez "1_dep" ou "2_pickup".`);
      return;
    }

    const withStarch = choice === '1_oui';
    const amidonnageTotal = withStarch ? AMIDONNAGE_PRICE * pending.qty : 0;
    const updatedPending = {
      ...pending,
      withStarch,
      total: pending.total + amidonnageTotal,
    };
    await userService.saveUserState(from, { pendingItem: updatedPending });

    await sendWhatsAppMessage(
      from,
      `${withStarch ? `Amidonnage ajouté (+${amidonnageTotal} FCFA). ` : ''}Total : ${updatedPending.total} FCFA\n\nComment souhaitez-vous procéder ?\n1️⃣ Dépôt au pressing → répondez "1_dep"\n2️⃣ Enlèvement à domicile → répondez "2_pickup"`
    );
    return;
  }

  // Étape 2/2 : dépôt ou enlèvement — on exige la décision amidonnage d'abord si applicable
  if (!pending.isAmidonnageOnly && pending.withStarch === undefined) {
    await sendWhatsAppMessage(from, `Merci de préciser d'abord si vous souhaitez l'amidonnage : répondez "1_oui" ou "2_non".`);
    return;
  }

  const deliveryLabel = choice === '1_dep' ? 'Dépôt au pressing' : 'Enlèvement à domicile';
  const starchLabel = pending.isAmidonnageOnly
    ? 'Service amidonnage'
    : (pending.withStarch ? `Avec amidonnage (+${AMIDONNAGE_PRICE} FCFA)` : 'Sans amidonnage');

  const order = {
    ClientPhone: from,
    ItemsJSON: [{
      N: pending.itemNumber,
      description: pending.description,
      option: deliveryLabel,
      amidonnage: starchLabel,
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
    if (process.env.MAKE_WEBHOOK_URL) await sendToMakeWebhook({ ...order, ItemsJSON: JSON.stringify(order.ItemsJSON) }, 'Orders');
  }

  await sendWhatsAppMessage(from, `Commande enregistrée ✅\n${pending.breakdown}\nOption : ${deliveryLabel}\nAmidonnage : ${starchLabel}\nTotal : ${order.Total} F`);

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

  const isListReply = message.type === 'interactive' && message.interactive?.type === 'list_reply';
  const rawBody = isListReply ? (message.interactive.list_reply?.id || '') : (message.text?.body || '');
  const body = rawBody.trim().toLowerCase();

  // ✅ Envoi du log vers Make
  if (process.env.MAKE_WEBHOOK_URL) {
    try {
      await sendToMakeWebhook(message, 'incoming_message');
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

  // ✅ Quantité demandée après sélection d'un article via la liste interactive
  if (state?.awaitingQtyFor && /^\d+$/.test(body)) {
    const itemNumber = state.awaitingQtyFor;
    await userService.saveUserState(from, { awaitingQtyFor: null });
    await handleItemSelection(from, state, `${itemNumber},${body}`);
    await userService.updateUserLastMessage(from, now);
    return;
  }

  // ✅ Choix d'une catégorie (liste interactive)
  if (body.startsWith('cat_')) {
    const category = SLUG_TO_CATEGORY[body.slice(4)];
    if (category && state?.priceType) {
      await sendItemList(from, category, state.priceType, 0);
    } else {
      await sendWhatsAppMessage(from, "Choix invalide ou expiré. Tapez '*' pour revenir au menu.");
    }
    await userService.updateUserLastMessage(from, now);
    return;
  }

  // ✅ Page suivante d'une catégorie (liste interactive)
  if (body.startsWith('catpage_')) {
    const match = body.match(/^catpage_([a-z]+)_(\d+)$/);
    const category = match ? SLUG_TO_CATEGORY[match[1]] : null;
    if (category && state?.priceType) {
      await sendItemList(from, category, state.priceType, parseInt(match[2], 10));
    } else {
      await sendWhatsAppMessage(from, "Choix invalide ou expiré. Tapez '*' pour revenir au menu.");
    }
    await userService.updateUserLastMessage(from, now);
    return;
  }

  // ✅ Sélection d'un article (liste interactive) → on demande la quantité
  if (body.startsWith('item_')) {
    const itemNumber = parseInt(body.slice(5), 10);
    const items = state?.priceType ? await readCatalog() : [];
    const item = items.find((i) => Number(i.N) === itemNumber);
    if (item && state?.priceType) {
      await userService.saveUserState(from, { awaitingQtyFor: itemNumber });
      await sendWhatsAppMessage(from, `Quelle quantité pour "${item.Désignation}" ? Répondez avec un nombre (ex: 2).`);
    } else {
      await sendWhatsAppMessage(from, "Article introuvable ou choix expiré. Tapez '*' pour revenir au menu.");
    }
    await userService.updateUserLastMessage(from, now);
    return;
  }

  // ✅ Sélection directe d'un article de catalogue par texte (ex: 8,2) après avoir choisi un service
  if (state?.priceType && /^\d+(\s*,\s*\d+)?$/.test(body)) {
    await handleItemSelection(from, state, body);
    await userService.updateUserLastMessage(from, now);
    return;
  }

  // ✅ Menu principal
  switch (body) {
    case '1':
      await userService.updateUserState(from, { service: 'lavage_sec', priceType: 'NS' });
      await sendCategoryList(from, 'NS');
      await userService.updateUserLastMessage(from, now);
      return;
    case '2':
      await userService.updateUserState(from, { service: 'lavage_eau', priceType: 'NE' });
      await sendCategoryList(from, 'NE');
      await userService.updateUserLastMessage(from, now);
      return;
    case '3':
      await userService.updateUserState(from, { service: 'repassage', priceType: 'REP' });
      await sendCategoryList(from, 'REP');
      await userService.updateUserLastMessage(from, now);
      return;
    case '4':
      await userService.updateUserState(from, { service: 'amidonnage', priceType: 'AM' });
      await sendCategoryList(from, 'AM');
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
