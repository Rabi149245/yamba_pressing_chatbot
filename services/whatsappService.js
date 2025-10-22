// services/whatsappService.js
import axios from 'axios';
import { computePriceFromCatalogue, readCatalog } from './orderService.js';
import { sendToMakeWebhook } from './makeService.js';

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const ADMIN_PHONE = process.env.ADMIN_PHONE ? process.env.ADMIN_PHONE.replace(/[\s\-+]/g, '').replace(/^0+/, '') : null;
const API_URL = PHONE_ID ? `https://graph.facebook.com/v17.0/${PHONE_ID}/messages` : null;

/**
 * sendRaw - basic WhatsApp text send
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
    // Log notification in Make (NotificationsLog)
    try {
      await sendToMakeWebhook({ action: 'log_notification', payload: { clientPhone: to, type: 'outbound_text', payload: text, sentAt: new Date().toISOString() } }, 'log_notification');
    } catch (e) {
      // non-blocking
    }
    return res.status === 200 || res.status === 201;
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
    try {
      await sendToMakeWebhook({ action: 'log_notification', payload: { clientPhone: to, type: 'outbound_text', payload: text, sentAt: new Date().toISOString(), status: 'failed', error: err.message } }, 'log_notification');
    } catch (e) {}
    return false;
  }
}

/**
 * sendWelcomeMenu - shown when first message after >=24h
 */
async function sendWelcomeMenu(to) {
  const text = `Bonjour 👋 et bienvenue chez Pressing Yamba 🧺\nJe suis votre assistant virtuel. Voici nos services :\n\n1️⃣ Lavage à sec\n2️⃣ Lavage à eau\n3️⃣ Repassage\n4️⃣ Autres services (amidonnage, enlèvement, livraison)\n5️⃣ Parler à un agent humain 👩🏽‍💼\n\n➡ Répondez par le chiffre (1 à 5). Tapez 0 pour revenir au menu à tout moment.`;
  return await sendText(to, text);
}

/**
 * sendServiceDetail - shows details for chosen service
 */
async function sendServiceDetail(to, serviceKey) {
  if (serviceKey === '1') {
    return await sendText(to, `Voici les prix pour le lavage à sec 👇\n🧺 Serviette : 900 F (NE) | Repassage : 300 F\n👔 Chemise : 1000 F | Costume : 3000 F\n\nSouhaitez-vous :\n1️⃣ Dépôt au pressing\n2️⃣ Enlèvement à domicile 🚚\n\nTapez 1 ou 2. Tapez 0 pour revenir au menu.`);
  } else if (serviceKey === '2') {
    return await sendText(to, `Lavage à eau 💧\n🧺 Serviette : 700 F\n👕 T-shirt : 500 F\nDrap : 1000 F\n\nSouhaitez-vous un amidonnage ?\n1️⃣ Oui\n2️⃣ Non\n\nTapez 0 pour revenir au menu.`);
  } else if (serviceKey === '3') {
    return await sendText(to, `Voici nos tarifs pour le repassage 👕\n\nChemise : 300 F\nPantalon : 400 F\nCostume : 800 F\n\nTapez 0 pour revenir au menu.`);
  } else if (serviceKey === '4') {
    return await sendText(to, `Services supplémentaires 🌟\n\nAmidonnage : 200 F par vêtement\nEnlèvement à domicile 🚚\nLivraison après nettoyage 📦\n\nTapez 0 pour revenir au menu.`);
  } else if (serviceKey === '5') {
    // create human request in Make (HumanRequest sheet)
    try {
      const makeResp = await sendToMakeWebhook({ action: 'create_human_request', payload: { clientPhone: to, note: 'Demande d\'assistance via menu 5' } }, 'create_human_request');
      await sendText(to, "Merci ! 😊\nUn membre de notre équipe va vous répondre dans quelques instants.");
      if (ADMIN_PHONE) {
        await sendText(ADMIN_PHONE, `Demande humaine de ${to} - ID: ${makeResp?.request_id || 'n/a'}`);
      }
      return true;
    } catch (e) {
      await sendText(to, "Nous n'avons pas pu enregistrer votre demande, mais un agent sera informé.");
      return false;
    }
  }
  return await sendText(to, 'Option inconnue. Tapez 0 pour revenir au menu.');
}

/**
 * Helper: try to fetch user record from Make
 * Expects Make to return { user: { Phone, Name, LastMessageAt, State, Points, LastOrderID } }
 */
async function getUserFromMake(phone) {
  try {
    const res = await sendToMakeWebhook({ action: 'get_user', payload: { phone } }, 'get_user');
    return res?.user || null;
  } catch (e) {
    console.warn('getUserFromMake failed:', e.message);
    return null;
  }
}

/**
 * Helper: update user in Make (upsert)
 */
async function updateUserInMake(phone, data = {}) {
  try {
    const res = await sendToMakeWebhook({ action: 'update_user', payload: { phone, data } }, 'update_user');
    return res;
  } catch (e) {
    console.warn('updateUserInMake failed:', e.message);
    return null;
  }
}

/**
 * handleIncomingMessage - main router for incoming WhatsApp messages
 */
async function handleIncomingMessage(message) {
  const from = message.from;
  if (!from) return;

  // Forward raw message to Make (for logging/analytics)
  try { await sendToMakeWebhook({ action: 'incoming_message', payload: { message } }, 'incoming_message'); } catch (e) {}

  // If location message -> create pickup (Pickups sheet)
  if (message.location) {
    const { latitude, longitude, address } = message.location;
    try {
      const makeResp = await sendToMakeWebhook({ action: 'create_pickup', payload: { clientPhone: from, lat: latitude, lon: longitude, address, status: 'pending', createdAt: new Date().toISOString() } }, 'create_pickup');
      await sendText(from, `Localisation reçue ✅. Nous organiserons l'enlèvement. Réf: ${makeResp?.pickup_id || 'n/a'}`);
      // optionally update user's state
      await updateUserInMake(from, { lastMessageAt: new Date().toISOString(), state: 'pickup_requested' });
    } catch (e) {
      await sendText(from, `Erreur lors de l'enregistrement de l'enlèvement. Veuillez réessayer.`);
    }
    return;
  }

  // Text processing:
  if (message.text && message.text.body) {
    const body = message.text.body.trim();
    const low = body.toLowerCase();

    // fetch user record
    const user = await getUserFromMake(from);
    const now = new Date();
    const lastMsgTs = user?.LastMessageAt ? new Date(user.LastMessageAt) : null;
    const hoursSinceLast = lastMsgTs ? (now - lastMsgTs) / (1000 * 60 * 60) : Infinity;

    // If first after >=24h -> show welcome menu and set state to 'menu'
    if (!lastMsgTs || hoursSinceLast >= 24) {
      await sendWelcomeMenu(from);
      await updateUserInMake(from, { LastMessageAt: now.toISOString(), State: 'menu' });
      return;
    }

    // Always allow '0' or 'menu' to return to main menu
    if (low === '0' || low === 'menu' || low === 'accueil') {
      await sendWelcomeMenu(from);
      await updateUserInMake(from, { State: 'menu', LastMessageAt: now.toISOString() });
      return;
    }

    // If user asks human explicitly
    if (low === 'humain' || low.includes('agent') || low.includes('parlez à un agent')) {
      // create HumanRequest and notify admin
      try {
        const makeResp = await sendToMakeWebhook({ action: 'create_human_request', payload: { clientPhone: from, note: body, status: 'pending', createdAt: now.toISOString() } }, 'create_human_request');
        await sendText(from, "Un agent humain va prendre en charge votre demande. ⏳");
        if (ADMIN_PHONE) await sendText(ADMIN_PHONE, `Nouvelle demande humaine: ${from} - ID: ${makeResp?.request_id || 'n/a'}`);
        await updateUserInMake(from, { State: 'wait_agent', LastMessageAt: now.toISOString() });
      } catch (e) {
        await sendText(from, "Impossible d'enregistrer la demande pour le moment. Un agent sera prévenu.");
      }
      return;
    }

    // If single digit 1-5 => open service details
    if (/^[1-5]$/.test(body)) {
      await sendServiceDetail(from, body);
      await updateUserInMake(from, { State: `service_${body}`, LastMessageAt: now.toISOString() });
      return;
    }

    // If user sends a comma-separated order: "N, NE, qty" OR "Designation, NE, qty"
    if (body.includes(',') && body.split(',').length >= 3) {
      const parts = body.split(',').map(p => p.trim());
      const index = parts[0];
      const priceType = parts[1].toUpperCase();
      const qty = parseInt(parts[2], 10);
      if (!isNaN(qty) && qty > 0) {
        try {
          // Ask Make for active promos (Make will return list; we apply any matching TargetService)
          let promoPercent = 0;
          try {
            const promosResp = await sendToMakeWebhook({ action: 'get_active_promos' }, 'get_active_promos');
            const promos = promosResp?.promos || [];
            // simplistic matching: if any promo.TargetService matches item designation or is empty, pick highest discount
            const itemCandidates = (await readCatalog()).filter(i => String(i.N) === String(index) || String(i.Désignation).toLowerCase() === String(index).toLowerCase());
            const itemName = itemCandidates[0]?.Désignation || index;
            let best = 0;
            for (const p of promos) {
              if (!p.Active) continue;
              if (!p.TargetService || String(p.TargetService).trim() === '' || String(p.TargetService).toLowerCase() === String(itemName).toLowerCase()) {
                const pct = Number(p.DiscountPercent) || 0;
                if (pct > best) best = pct;
              }
            }
            promoPercent = best;
          } catch (e) {
            // ignore promo fetch failure, proceed without promo
            promoPercent = 0;
          }

          const { totalBeforeDiscount, discountAmount, total, breakdown, item, unit } = await computePriceFromCatalogue(index, priceType, qty, promoPercent);

          // assemble order payload (ItemsJSON)
          const itemsJSON = JSON.stringify([{ type: item.Désignation || index, service: priceType, qty, unitPrice: unit }]);

          const orderPayload = {
            clientPhone: from,
            name: user?.Name || '',
            itemsJSON,
            total,
            totalBeforeDiscount,
            discountAmount,
            status: 'pending',
            createdAt: new Date().toISOString(),
            pickupOrDrop: null // to be set by user later; Make can update
          };

          // Create order in Make (Orders sheet) and also add order item rows if desired
          const makeResp = await sendToMakeWebhook({ action: 'create_order', payload: orderPayload }, 'create_order');

          // Ask Make to add order items row(s)
          try {
            await sendToMakeWebhook({ action: 'add_order_item', payload: { order_id: makeResp?.order_id, items: JSON.parse(itemsJSON) } }, 'add_order_item');
          } catch (e) { /* non-blocking */ }

          // Add points transaction (award points) — example: 1 point per 1000 FCFA
          try {
            const pointsGained = Math.floor(total / 1000);
            if (pointsGained > 0) {
              await sendToMakeWebhook({ action: 'add_points_tx', payload: { clientPhone: from, order_id: makeResp?.order_id, pointsChange: pointsGained, reason: 'earn', createdAt: new Date().toISOString() } }, 'add_points_tx');
            }
          } catch (e) {}

          // Reply to user with breakdown and request confirmation
          await sendText(from, `Récapitulatif: ${breakdown}\nTotal à payer (après remise éventuelle): ${total} FCFA\nRépondez 'oui' pour confirmer votre commande.`);

          // Save last order id to user
          await updateUserInMake(from, { LastOrderAt: new Date().toISOString(), LastOrderID: makeResp?.order_id, State: 'awaiting_confirmation', LastMessageAt: new Date().toISOString() });
          return;
        } catch (err) {
          console.error('Order processing error:', err);
          await sendText(from, 'Erreur: article ou type de tarif introuvable ou promo non disponible. Vérifiez le numéro et le type (NE/NS/REP).');
          return;
        }
      }
    }

    // If user was awaiting confirmation (state) and replies 'oui' or 'non'
    const currentState = user?.State || '';
    if (currentState && currentState.toLowerCase().includes('awaiting_confirmation')) {
      if (low === 'oui' || low === 'o' || low === 'yes') {
        try {
          // confirm last order in Make
          await sendToMakeWebhook({ action: 'confirm_last_order', payload: { clientPhone: from } }, 'confirm_last_order');
          await sendText(from, 'Merci ✅. Votre commande est confirmée et enregistrée. Nous vous contacterons pour l\'enlèvement/livraison.');
          await updateUserInMake(from, { State: 'order_confirmed', LastMessageAt: new Date().toISOString() });
        } catch (e) {
          await sendText(from, 'Erreur lors de la confirmation. Veuillez réessayer plus tard.');
        }
      } else if (low === 'non') {
        await sendText(from, 'Commande annulée. Tapez 0 pour revenir au menu.');
        await updateUserInMake(from, { State: 'menu', LastMessageAt: new Date().toISOString() });
      } else {
        await sendText(from, "Répondez 'oui' pour confirmer la commande ou 'non' pour annuler.");
      }
      return;
    }

    // Default help message within 24h
    await sendText(from, "Bienvenue! Tapez 'catalogue' pour voir la liste, envoyez 'N, NE/NS/REP, qty' pour commander, 'humain' pour parler à un agent, ou 0 pour le menu.");
    await updateUserInMake(from, { LastMessageAt: new Date().toISOString() });
    return;
  }

  // Non-text fallback
  await sendText(from, 'Type de message non géré. Souhaitez-vous parler à un agent ? Tapez "humain".');
  try { await updateUserInMake(from, { LastMessageAt: new Date().toISOString() }); } catch (e) {}
}

export { sendText, handleIncomingMessage };
