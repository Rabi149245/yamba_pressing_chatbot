import axios from 'axios';
import { computePriceFromCatalogue, readCatalog, addOrder } from './orderService.js';
import { sendToMakeWebhook } from './makeService.js';
import * as userService from './userService.js';
import * as pointsService from './pointsService.js';
import * as notificationsService from './notificationsService.js';
import * as agentsService from './agentsService.js';
import * as humanService from './humanService.js';
import * as pickupService from './pickupService.js';

// ─── Constantes ───────────────────────────────────────────────────────────────
const TOKEN          = process.env.WHATSAPP_TOKEN;
const PHONE_ID       = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;
const INACTIVITY_MS  = 24 * 60 * 60 * 1000; // 24 h

if (!TOKEN || !PHONE_ID) {
  console.warn('[WhatsApp] ⚠️ WHATSAPP_TOKEN ou WHATSAPP_PHONE_ID manquant.');
}

// ─── Mapping service → catégories catalogue ──────────────────────────────────
const SERVICE_CATEGORIES = {
  lavage_sec:      ['Haut', 'Bas', 'Costume/Veste', 'Ensemble/Robe', 'Autre'],
  lavage_eau:      ['Drap/Grand', 'Autre'],
  repassage:       ['Haut', 'Bas', 'Costume/Veste', 'Ensemble/Robe', 'Autre'],
  autres_services: ['Drap/Grand', 'Autre'],
};

// ─── Messages ─────────────────────────────────────────────────────────────────
const WELCOME_MESSAGE =
  `👋 Bonjour et bienvenue chez *Pressing Yamba* 🧺\n` +
  `Je suis votre assistant virtuel. Comment puis-je vous aider ?\n\n` +
  `1️⃣  Lavage à sec\n` +
  `2️⃣  Lavage à eau\n` +
  `3️⃣  Repassage\n` +
  `4️⃣  Autres services\n` +
  `5️⃣  Parler à un agent 👩🏽‍💼\n\n` +
  `➡️  Répondez par un chiffre (1 à 5).\n` +
  `Tapez ✱ à tout moment pour revenir à ce menu.`;

const DELIVERY_MENU =
  `Comment souhaitez-vous procéder ?\n\n` +
  `1️⃣  Taper *1_dep*  — Dépôt au pressing\n` +
  `2️⃣  Taper *2_pickup*  — Enlèvement à domicile 🚚`;

const STARCH_MENU =
  `Souhaitez-vous de l'*amidonnage* ?\n\n` +
  `1️⃣  Taper *1_oui*  — Avec amidonnage\n` +
  `2️⃣  Taper *2_non*  — Sans amidonnage`;

// ─── Envoi de messages ────────────────────────────────────────────────────────
export async function sendWhatsAppMessage(to, text) {
  if (!TOKEN || !PHONE_ID) {
    console.error('[WhatsApp] Token ou Phone ID manquant.');
    return false;
  }
  if (!to || !text) {
    console.warn('[WhatsApp] ⚠️ sendWhatsAppMessage : paramètres manquants.');
    return false;
  }
  try {
    await axios.post(
      WHATSAPP_API_URL,
      { messaging_product: 'whatsapp', to, text: { body: text } },
      { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
    );
    notificationsService.logNotification(to, text, null, 'Message').catch(() => {});
    console.info(`[WhatsApp] ✅ Message → ${to}`);
    return true;
  } catch (err) {
    console.error('[WhatsApp] ❌ sendWhatsAppMessage :', err.response?.data || err.message);
    return false;
  }
}

export async function sendWhatsAppImage(to, imageUrl, caption = '') {
  if (!TOKEN || !PHONE_ID) {
    console.error('[WhatsApp] Token ou Phone ID manquant.');
    return false;
  }
  if (!to || !imageUrl) {
    console.warn('[WhatsApp] ⚠️ sendWhatsAppImage : paramètres manquants.');
    return false;
  }
  try {
    await axios.post(
      WHATSAPP_API_URL,
      { messaging_product: 'whatsapp', to, type: 'image', image: { link: imageUrl, caption } },
      { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
    );
    notificationsService.logNotification(to, caption, imageUrl, 'Image').catch(() => {});
    console.info(`[WhatsApp] ✅ Image → ${to}`);
    return true;
  } catch (err) {
    console.error('[WhatsApp] ❌ sendWhatsAppImage :', err.response?.data || err.message);
    return false;
  }
}

// ─── Affichage catalogue filtré ───────────────────────────────────────────────
async function sendCatalogForService(to, serviceKey) {
  try {
    const catalog    = await readCatalog();
    const categories = SERVICE_CATEGORIES[serviceKey] || [];
    const items      = catalog.filter(i => categories.includes(i.Catégorie));

    if (!items.length) {
      await sendWhatsAppMessage(to, '⚠️ Aucun article disponible pour ce service.');
      return;
    }

    // Envoi d'une ligne par article avec prix
    const lines = items.map(i => {
      const parts = [];
      if (i.NE)  parts.push(`NE: ${i.NE} F`);
      if (i.NS)  parts.push(`NS: ${i.NS} F`);
      if (i.REP) parts.push(`REP: ${i.REP} F`);
      return `  *${i.N}* — ${i.Désignation}  (${parts.join(' | ')})`;
    });

    const msg =
      `📋 *Tarifs — ${serviceKey.replace('_', ' ')}*\n\n` +
      lines.join('\n') +
      `\n\n` +
      `Pour commander, tapez : *N, TYPE, quantité*\n` +
      `Exemple : *8, NE, 2*  (Chemise Bazin × 2, tarif Normal Express)\n\n` +
      `*NE* = Normal Express  |  *NS* = Normal Simple  |  *REP* = Repassage seul`;

    await sendWhatsAppMessage(to, msg);

    // Sous-menu livraison / retrait
    await sendWhatsAppMessage(to, DELIVERY_MENU);
  } catch (err) {
    console.error('[WhatsApp] ❌ sendCatalogForService :', err.message);
    await sendWhatsAppMessage(to, '⚠️ Erreur lors de la récupération du catalogue. Veuillez réessayer.');
  }
}

// ─── Traitement commande complète ─────────────────────────────────────────────
async function processOrder(from, itemIndex, priceType, qty, option = 'Commande directe') {
  const priceRes = await computePriceFromCatalogue(itemIndex, priceType, qty);

  if (priceRes?.status !== 'ok') {
    await sendWhatsAppMessage(from, `⚠️ ${priceRes?.message || 'Erreur de calcul du prix.'}`);
    return null;
  }

  const order = {
    ClientPhone: from,
    ItemsJSON: [{
      N: itemIndex,
      description: priceRes.item?.Désignation || String(itemIndex),
      option,
      priceType,
      qty,
      total: priceRes.total,
    }],
    Total: priceRes.total,
    Status: 'Pending',
    CreatedAt: new Date().toISOString(),
  };

  await addOrder(order);

  // Créditer les points (1 pt / 100 FCFA)
  const pts = Math.floor(order.Total / 100);
  if (pts > 0) {
    pointsService.addPoints(from, pts, `Commande ${option}`).catch(() => {});
  }

  return { order, breakdown: priceRes.breakdown, total: priceRes.total, pts };
}

// ─── Sous-menus (dépôt / pickup / amidonnage) ─────────────────────────────────
async function handleSubMenuResponses(from, choice) {
  const state = await userService.getUserState(from);

  if (!state?.service) {
    await sendWhatsAppMessage(from, "⚠️ Aucun service sélectionné. Tapez ✱ pour revenir au menu.");
    return;
  }

  // Si une commande directe est en attente de confirmation de livraison
  if (state.pendingOrder && (choice === '1_dep' || choice === '2_pickup')) {
    const option = choice === '1_dep' ? 'Dépôt au pressing' : 'Enlèvement à domicile';
    const { order, breakdown, total, pts } = state.pendingOrder;

    order.ItemsJSON[0].option = option;
    order.DeliveryOption       = option;

    await addOrder(order);

    if (choice === '2_pickup') {
      await pickupService.handlePickupRequest(from, state.clientName || 'client(e)');
    }

    if (pts > 0) {
      pointsService.addPoints(from, pts, `Commande ${option}`).catch(() => {});
    }

    await sendWhatsAppMessage(
      from,
      `✅ *Commande confirmée !*\n\n` +
      `📦 ${breakdown}\n` +
      `🚚 Mode : ${option}\n` +
      `💰 Total : *${total} FCFA*\n` +
      `🎁 Points gagnés : *+${pts} pts*\n\n` +
      `Tapez ✱ pour revenir au menu.`
    );
    await userService.clearUserState(from);
    return;
  }

  // Sous-menu amidonnage (repassage)
  if (state.service === 'repassage' && (choice === '1_oui' || choice === '2_non')) {
    const catalog  = await readCatalog();
    const items    = catalog.filter(i => ['Haut', 'Bas', 'Ensemble/Robe'].includes(i.Catégorie));
    const item     = items[0];
    if (!item) {
      await sendWhatsAppMessage(from, '⚠️ Catalogue vide. Tapez ✱ pour recommencer.');
      return;
    }

    const priceType = choice === '1_oui' ? 'REP' : 'NE';
    const result    = await processOrder(from, item.N, priceType, 1, choice === '1_oui' ? 'Avec amidonnage' : 'Sans amidonnage');
    if (!result) return;

    await sendWhatsAppMessage(
      from,
      `✅ *Commande repassage enregistrée !*\n\n${result.breakdown}\nTotal : *${result.total} FCFA*\n\nTapez ✱ pour revenir au menu.`
    );
    await userService.clearUserState(from);
    return;
  }

  await sendWhatsAppMessage(from, "⚠️ Option invalide. Tapez ✱ pour revenir au menu.");
}

// ─── Gestion des messages entrants ───────────────────────────────────────────
export async function handleIncomingMessage(message) {
  const from = message?.from;
  if (!from) return;

  const rawBody = (message.text?.body || '').trim();
  const body    = rawBody.toLowerCase();

  // Log fire-and-forget vers Make
  sendToMakeWebhook({ incoming: message }, 'incoming_message').catch(() => {});

  const now           = new Date();
  const lastMessageAt = await userService.getUserLastMessage(from);
  const isNewSession  = !lastMessageAt || (now - new Date(lastMessageAt)) > INACTIVITY_MS;

  // ── Nouvelle session (>24h) ──────────────────────────────────────────────
  if (isNewSession) {
    await sendWhatsAppMessage(from, WELCOME_MESSAGE);
    await userService.clearUserState(from);
    await userService.updateUserLastMessage(from, now);
    return;
  }

  await userService.updateUserLastMessage(from, now);

  // ── Retour au menu ───────────────────────────────────────────────────────
  if (body === '*' || body === '✱' || body === 'menu') {
    await sendWhatsAppMessage(from, WELCOME_MESSAGE);
    await userService.clearUserState(from);
    return;
  }

  // ── Commande avancée : "N, TYPE, quantité" ───────────────────────────────
  if (body.includes(',')) {
    const parts = body.split(',').map(p => p.trim());
    if (parts.length >= 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[2])) {
      const index     = parseInt(parts[0], 10);
      const priceType = parts[1].toUpperCase();
      const qty       = parseInt(parts[2], 10);

      const result = await processOrder(from, index, priceType, qty);
      if (!result) return;

      // Sauvegarder la commande en attente (choix dépôt/pickup)
      await userService.saveUserState(from, {
        pendingOrder: result,
        service: (await userService.getUserState(from)).service || 'direct',
      });

      await sendWhatsAppMessage(
        from,
        `🧾 *Récapitulatif :*\n\n${result.breakdown}\nTotal : *${result.total} FCFA*\n\n` + DELIVERY_MENU
      );
      return;
    }
  }

  // ── Sous-menus ────────────────────────────────────────────────────────────
  const subMenuChoices = ['1_dep', '2_pickup', '1_oui', '2_non'];
  if (subMenuChoices.includes(body)) {
    await handleSubMenuResponses(from, body);
    return;
  }

  // ── Menu principal ────────────────────────────────────────────────────────
  switch (body) {
    case '1':
      await userService.saveUserState(from, { service: 'lavage_sec' });
      await sendCatalogForService(from, 'lavage_sec');
      break;

    case '2':
      await userService.saveUserState(from, { service: 'lavage_eau' });
      await sendCatalogForService(from, 'lavage_eau');
      break;

    case '3':
      await userService.saveUserState(from, { service: 'repassage' });
      await sendCatalogForService(from, 'repassage');
      await sendWhatsAppMessage(from, STARCH_MENU);
      break;

    case '4':
      await userService.saveUserState(from, { service: 'autres_services' });
      await sendCatalogForService(from, 'autres_services');
      break;

    case '5': {
      // Escalade vers un agent humain
      await sendWhatsAppMessage(from, '⏳ Un instant, je vous mets en relation avec un agent...');
      const agent = await agentsService.assignAgent();
      if (agent?.Phone) {
        await sendWhatsAppMessage(agent.Phone,
          `🔔 *Nouvelle demande d'assistance*\nClient : ${from}\nMessage : ${rawBody || '(aucun texte)'}`
        );
      }
      const confirmMsg = await humanService.escalateToHuman(from, 'client(e)', rawBody);
      await sendWhatsAppMessage(from, confirmMsg);
      await userService.clearUserState(from);
      break;
    }

    // ── Solde de points ────────────────────────────────────────────────────
    case 'points':
    case 'fidelite':
    case 'fidélité': {
      const pts = await pointsService.getPoints(from);
      await sendWhatsAppMessage(from,
        `🎁 *Votre solde de points fidélité :* *${pts} pts*\n\n` +
        `1 point = 1 FCFA de réduction sur votre prochaine commande.\n` +
        `Tapez ✱ pour revenir au menu.`
      );
      break;
    }

    // ── Promotions ─────────────────────────────────────────────────────────
    case 'promo':
    case 'promotions': {
      const { listPromotions } = await import('./promoService.js');
      const promos = await listPromotions();
      if (!promos.length) {
        await sendWhatsAppMessage(from, '😔 Aucune promotion en cours pour le moment.\nTapez ✱ pour revenir au menu.');
      } else {
        const lines = promos.map(p =>
          `🏷️ *${p.title}* — ${p.discount}% de réduction\n   ${p.description}\n   Valable jusqu'au ${p.validUntil}`
        ).join('\n\n');
        await sendWhatsAppMessage(from, `🎉 *Promotions en cours :*\n\n${lines}\n\nTapez ✱ pour revenir au menu.`);
      }
      break;
    }

    // ── Feedback ───────────────────────────────────────────────────────────
    case 'avis':
    case 'feedback': {
      await userService.saveUserState(from, { awaitingFeedback: true });
      await sendWhatsAppMessage(from,
        `💬 Nous apprécions votre retour !\nEnvoyez votre avis (texte libre).\n` +
        `Vous pouvez aussi ajouter une note : termininez par *#1* à *#5* (ex: "Très satisfait #5")`
      );
      break;
    }

    default: {
      // Vérifier si l'utilisateur est en attente de feedback
      const state = await userService.getUserState(from);
      if (state?.awaitingFeedback) {
        const ratingMatch = rawBody.match(/#([1-5])$/);
        const rating      = ratingMatch ? parseInt(ratingMatch[1]) : null;
        const msgClean    = rawBody.replace(/#[1-5]$/, '').trim();

        const { logFeedback } = await import('./feedbackService.js');
        await logFeedback(from, msgClean, rating);
        await sendWhatsAppMessage(from,
          `✅ Merci pour votre avis ! Votre satisfaction est notre priorité 🙏\nTapez ✱ pour revenir au menu.`
        );
        await userService.clearUserState(from);
        return;
      }

      // Message non reconnu
      await sendWhatsAppMessage(from,
        `❓ Je n'ai pas compris votre message.\n\n` +
        `Tapez un *chiffre de 1 à 5* pour choisir un service.\n` +
        `Tapez *N, TYPE, quantité* pour une commande directe (ex: *8, NE, 2*).\n` +
        `Tapez *points* pour voir votre solde fidélité.\n` +
        `Tapez *promo* pour les promotions en cours.\n` +
        `Tapez *avis* pour nous laisser un feedback.\n` +
        `Tapez ✱ pour revenir au menu principal.`
      );
      break;
    }
  }
}
