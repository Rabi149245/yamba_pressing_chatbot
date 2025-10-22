import axios from 'axios';
import { computePriceFromCatalogue, readCatalog } from './orderService.js';
import { sendToMakeWebhook } from './makeService.js';
import * as userService from './userService.js';
import * as orderService from './orderService.js';
import * as pickupService from './pickupService.js';
import * as promoService from './promoService.js';
import * as humanService from './humanService.js';
import * as pointsService from './pointsService.js';
import * as notificationsService from './notificationsService.js';
import * as agentsService from './agentsService.js';

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const ADMIN_PHONE = process.env.ADMIN_PHONE.replace(/[\s\-+]/g, '').startsWith('226')
    ? process.env.ADMIN_PHONE.replace(/[\s\-+]/g, '')
    : '226' + process.env.ADMIN_PHONE.replace(/[\s\-+]/g, '');
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
        const payload = {
            messaging_product: 'whatsapp',
            to,
            type: 'image',
            image: { link: imageUrl, caption }
        };
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
// Gestion des messages entrants
// ---------------------------
async function handleIncomingMessage(message) {
    const from = message.from;
    if (!from) return;

    // Envoi vers Make
    if (process.env.MAKE_WEBHOOK_URL) {
        try { await sendToMakeWebhook({ incoming: message }, 'incoming_message'); } catch (e) { }
    }

    const now = new Date();
    const lastMessageAt = await userService.getUserLastMessage(from);

    // ---------------------------
    // Message d'accueil automatique toutes les 24h
    // ---------------------------
    if (!lastMessageAt || (now - new Date(lastMessageAt)) > 24 * 60 * 60 * 1000) {
        await sendText(from, WELCOME_MESSAGE);
        await userService.updateUserLastMessage(from, now);
        return;
    }

    // ---------------------------
    // Gestion menu interactif et sous-menus
    // ---------------------------
    if (message.text && message.text.body) {
        const body = message.text.body.trim();

        // Retour au menu principal
        if (body === '*') {
            await sendText(from, WELCOME_MESSAGE);
            await userService.updateUserLastMessage(from, now);
            return;
        }

        // Gestion des réponses principales
        switch (body) {
            case '1': // Lavage à sec
                await sendImage(from, 'https://exemple.com/lavage_sec.jpg',
                    'Voici les prix pour le lavage à sec 👇\n🧺 Serviette : 900 F (NE) | Repassage : 300 F\n👔 Chemise : 1000 F | Costume : 3000 F\n\nSouhaitez-vous :\n1️⃣ Dépôt au pressing\n2️⃣ Enlèvement à domicile 🚚');
                await userService.updateUserState(from, { service: 'lavage_sec' });
                break;
            case '2': // Lavage à eau
                await sendImage(from, 'https://exemple.com/lavage_eau.jpg',
                    'Lavage à eau 💧\n🧺 Serviette : 700 F\n👕 T-shirt : 500 F\nDrap : 1000 F\n\nSouhaitez-vous un amidonnage ?\n1️⃣ Oui\n2️⃣ Non');
                await userService.updateUserState(from, { service: 'lavage_eau' });
                break;
            case '3': // Repassage
                await sendImage(from, 'https://exemple.com/repassage.jpg',
                    'Voici nos tarifs pour le repassage 👕\nChemise : 300 F\nPantalon : 400 F\nCostume : 800 F');
                await userService.updateUserState(from, { service: 'repassage' });
                break;
            case '4': // Autres services
                await sendImage(from, 'https://exemple.com/autres_services.jpg',
                    'Services supplémentaires 🌟\nAmidonnage : 200 F par vêtement\nEnlèvement à domicile 🚚\nLivraison après nettoyage 📦');
                await userService.updateUserState(from, { service: 'autres_services' });
                break;
            case '5': // Parler à un humain
                await sendText(from, 'Merci ! 😊\nUn membre de notre équipe va vous répondre dans quelques instants.');
                const agent = await agentsService.assignAgent();
                if (agent) await sendText(agent.Phone, `Nouvelle demande d'assistance de ${from}`);
                await humanService.createHumanRequest(from);
                break;

            // ---------------------------
            // Sous-menus (dépôt/enlèvement, amidonnage)
            // ---------------------------
            case '1_dep': // dépôt au pressing
            case '2_pickup': // enlèvement à domicile
            case '1_oui': // amidonnage oui
            case '2_non': // amidonnage non
                await handleSubMenuResponses(from, body);
                break;

            default:
                await sendText(from, "Je n'ai pas compris votre choix. Tapez un chiffre entre 1 et 5 ou '*' pour revenir au menu.");
        }

        await userService.updateUserLastMessage(from, now);
        return;
    }

    await sendText(from, 'Type de message non géré. Tapez "*" pour revenir au menu principal.');
}

// ---------------------------
// Gestion sous-menus et création de commandes
// ---------------------------
async function handleSubMenuResponses(from, choice) {
    const state = await userService.getUserState(from);
    if (!state?.service) {
        await sendText(from, "Erreur : aucun service sélectionné. Tapez '*' pour revenir au menu.");
        return;
    }

    let order = {
        ClientPhone: from,
        ItemsJSON: [],
        Total: 0,
        Status: 'Pending',
        CreatedAt: new Date().toISOString()
    };

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

    // Calcul du prix
    order.Total = computePriceFromCatalogue(order.ItemsJSON);
    await orderService.addOrder(order);
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
export { sendText, sendImage, handleIncomingMessage };
