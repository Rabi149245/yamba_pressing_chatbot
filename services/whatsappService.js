// src/services/whatsappService.js
import axios from 'axios';
import { computePriceFromCatalogue, addOrder } from './orderService.js';
import { sendToMakeWebhook } from './makeService.js';
import * as userService from './userService.js';

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;

/**
 * Envoi d'un message WhatsApp
 */
export async function sendWhatsAppMessage(to, text) {
  try {
    await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: 'whatsapp',
        to,
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    console.error('Erreur envoi message WhatsApp :', err.response?.data || err.message);
  }
}

/**
 * Traitement des messages entrants
 */
export async function handleIncomingMessage(message) {
  const from = message.from;
  const text = (message.text?.body || '').trim().toLowerCase();

  // Récupération du state utilisateur
  const userState = await userService.getUserState(from);

  // --- 1️⃣ Gestion du mot-clé de confirmation ("oui") ---
  if (['oui', 'o', 'yes', 'y'].includes(text)) {
    const pending = userState?.pendingOrder;
    if (pending) {
      try {
        await addOrder(pending);
        await sendWhatsAppMessage(from, `✅ Merci ! Votre commande a bien été enregistrée.\nTotal : ${pending.total} FCFA\nNous la traiterons dans les plus brefs délais.`);
        await userService.clearUserState(from);
      } catch (err) {
        console.error('Erreur confirmation commande :', err.message);
        await sendWhatsAppMessage(from, `⚠️ Une erreur est survenue lors de l’enregistrement de votre commande.`);
      }
      return;
    } else {
      await sendWhatsAppMessage(from, "Vous n'avez aucune commande en attente à confirmer.");
      return;
    }
  }

  // --- 2️⃣ Exemple : commande directe (désignation + quantité) ---
  const match = text.match(/(\d+)\s*([a-z]+)/i);
  if (match) {
    const [_, qty, type] = match;
    const itemIndex = 1; // simplifié, à adapter selon ton cas
    const result = await computePriceFromCatalogue(itemIndex, type.toUpperCase(), Number(qty));

    if (result.status === 'ok') {
      const order = {
        from,
        item: result.item,
        qty: Number(qty),
        total: result.total,
        breakdown: result.breakdown,
        createdAt: new Date().toISOString(),
      };

      // Sauvegarde temporaire pour confirmation
      await userService.saveUserState(from, { pendingOrder: order });

      await sendWhatsAppMessage(from, `🧾 ${result.breakdown}\nTotal : ${result.total} FCFA\n\nSouhaitez-vous confirmer la commande ? (Répondez "oui" pour valider)`);
    } else {
      await sendWhatsAppMessage(from, `❌ ${result.message}`);
    }

    return;
  }

  // --- 3️⃣ Réponse par défaut ---
  await sendWhatsAppMessage(from, "Bonjour 👋 ! Que souhaitez-vous faire aujourd’hui ?");
}
