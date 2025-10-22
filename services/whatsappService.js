import axios from 'axios';
import { computePriceFromCatalogue, readCatalog, addOrder } from './orderService.js';
import { sendToMakeWebhook } from './services/makeService.js';
import * as userService from './services/userService.js';
import * as pickupService from './services/pickupService.js';
import * as promoService from './services/promoService.js';
import * as humanService from './humanService.js';
import * as pointsService from './services/pointsService.js';
import * as notificationsService from './services/notificationsService.js';
import * as agentsService from './services/agentsService.js';

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

    // Forward vers Make
    if (process.env.MAKE_WEBHOOK_URL) {
        try { await sendToMakeWebhook({ incoming: message }, 'incoming_message'); } catch (e) { }
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
                await sendImage(from, 'https://exemple.com/lavage_sec.jpg', 'Prix Lavage à sec...');
                await userService.updateUserState(from, { service: 'lavage_sec' });
                break;
            case '2':
                await sendImage(from, 'https://exemple.com/lavage_eau.jpg', 'Prix Lavage à eau...');
                await userService.updateUserState(from, { service: 'lavage_eau' });
                break;
            case '3':
                await sendImage(from, 'https://exemple.com/repassage.jpg', 'Prix Repassage...');
                await userService.updateUserState(from, { service: 'repassage' });
                break;
            case '4':
                await sendImage(from, 'https://exemple.com/autres_services.jpg', 'Autres services...');
                await userService.updateUserState(from, { service: 'autres_services' });
                break;
            case '5':
                await sendText(from, 'Merci ! Un agent humain va vous répondre.');
                const agent = await agentsService.assignAgent();
                if (agent) await sendText(agent.Phone, `Nouvelle demande d'assistance de ${from}`);
                await humanService.createHumanRequest(from);
                break;
            case '1_dep':
            case '2_pickup':
            case '1_oui':
            case '2_non':
                await handleSubMenuResponses(from, body);
                break;
            default:
                await sendText(from, "Je n'ai pas compris votre choix. Tapez 1-5 ou '*' pour revenir au menu.");
        }

        await userService.updateUserLastMessage(from, now);
    } else {
        await sendText(from, 'Type de message non géré. Tapez "*" pour revenir au menu.');
    }
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

    const catalogue = await readCatalog();
    const order = { ClientPhone: from, ItemsJSON: [], Total: 0, Status: 'Pending', CreatedAt: new Date().toISOString() };

    switch (choice) {
        case '1_dep':
            order.ItemsJSON.push({ type: state.service, option: 'Dépôt au pressing' });
            break;
        case '2_pickup':
            order.ItemsJSON.push({ type: state.service, option: 'Enlèvement à domicile' });
            break;
        case '1_oui':
            order.ItemsJSON.push({ type: state.service, amidonnage: true });
            break;
        case '2_non':
            order.ItemsJSON.push({ type: state.service, amidonnage: false });
            break;
    }

    // Calcul du total en utilisant computePriceFromCatalogue pour chaque item
    let total = 0;
    for (let item of order.ItemsJSON) {
        try {
            const { total: itemTotal } = await computePriceFromCatalogue(item.type, item.option ? 'NE' : 'REP', 1);
            item.Total = itemTotal;
            total += itemTotal;
        } catch (err) {
            console.warn('Erreur calcul prix:', err.message);
        }
    }
    order.Total = total;

    // Sauvegarde de la commande
    await addOrder(order);

    // Envoi feedback utilisateur
    await sendText(from, `Commande enregistrée ✅\nTotal estimé : ${order.Total} F`);

    // Mise à jour points fidélité
    await pointsService.addPoints(from, Math.floor(order.Total / 100));

    // Notification Make
    if (process.env.MAKE_WEBHOOK_URL) {
        await sendToMakeWebhook({ event: 'order_created', payload: order }, 'Orders');
    }

    await userService.clearUserState(from);
}

// ---------------------------
// Export
// ---------------------------
export { sendText, sendImage, handleIncomingMessage, sendWelcomeIfNeeded };
