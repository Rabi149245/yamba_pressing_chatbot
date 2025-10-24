// src/services/orderService.js
import fs from 'fs';
import path from 'path';
import { sendToMakeWebhook } from './makeService.js';

const dataDir = path.resolve('./data');
const cataloguePath = path.join(dataDir, 'catalogue.json');
const ordersPath = path.join(dataDir, 'orders_log.json');

// ---------------------------
// Vérification de configuration
// ---------------------------
if (!process.env.MAKE_WEBHOOK_URL) {
  console.warn('[WARN] MAKE_WEBHOOK_URL non configurée — le mode local sera utilisé.');
}

// ---------------------------
// Lecture du catalogue
// ---------------------------
export async function readCatalog() {
  try {
    if (!fs.existsSync(cataloguePath)) return [];
    const raw = await fs.promises.readFile(cataloguePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[ERROR][readCatalog]', err.message);
    throw new Error('Impossible de lire le catalogue');
  }
}

// ---------------------------
// Calcul du prix à partir du catalogue
// ---------------------------
export async function computePriceFromCatalogue(index, priceType, qty = 1) {
  const items = await readCatalog();
  const item = items.find(
    (i) => Number(i.N) === Number(index) || i.N == index || i.Désignation == index
  );

  if (!item) return { status: 'error', message: 'Item non trouvé' };

  const field =
    priceType === 'NE' ? 'NE' :
    priceType === 'NS' ? 'NS' :
    priceType === 'REP' ? 'REP' :
    priceType === 'AM' ? 'AM' : null;

  if (!field) return { status: 'error', message: 'Type de prix invalide' };

  const price = Number(item[field] || 0);
  if (isNaN(price) || price <= 0)
    return { status: 'error', message: 'Prix non disponible' };

  const total = price * qty;
  const breakdown = `${qty} x ${item.Désignation} (${priceType}) -> ${price} FCFA chacun`;

  // Journalisation vers Make
  if (process.env.MAKE_WEBHOOK_URL) {
    try {
      await sendToMakeWebhook(
        { event: 'log_order_item', payload: { item, priceType, qty, total } },
        'OrderItems'
      );
      if (process.env.DEBUG_MAKE === 'true')
        console.log('[DEBUG][computePriceFromCatalogue] Envoi à Make réussi');
    } catch (e) {
      console.warn('[WARN][computePriceFromCatalogue] Envoi Make échoué:', e.message);
    }
  }

  return { status: 'ok', total, breakdown, item };
}

// ---------------------------
// Ajout de commande (local + Make)
// ---------------------------
export async function addOrder(order) {
  if (process.env.MAKE_WEBHOOK_URL) {
    try {
      await sendToMakeWebhook({ event: 'create_order', payload: order }, 'Orders');
      if (process.env.DEBUG_MAKE === 'true')
        console.log('[DEBUG][addOrder] Commande envoyée à Make');
      return { status: 'ok' };
    } catch (err) {
      console.error('[ERROR][addOrder] Envoi Make échoué:', err.message);
      await saveOrderLocally(order, '[FALLBACK après erreur Make]');
      throw err;
    }
  } else {
    // Sauvegarde locale en fallback direct
    return saveOrderLocally(order, '[MODE LOCAL]');
  }
}

// ---------------------------
// Sauvegarde locale robuste (anti-conflit)
// ---------------------------
async function saveOrderLocally(order, sourceTag = '') {
  try {
    await fs.promises.mkdir(dataDir, { recursive: true });
    const lockFile = `${ordersPath}.lock`;

    // Verrou léger pour éviter les écritures concurrentes
    if (fs.existsSync(lockFile)) {
      console.warn('[WARN][saveOrderLocally] Fichier verrou détecté — tentative ignorée');
      return { status: 'pending_lock' };
    }

    await fs.promises.writeFile(lockFile, Date.now().toString());

    const list = fs.existsSync(ordersPath)
      ? JSON.parse(await fs.promises.readFile(ordersPath, 'utf-8'))
      : [];

    list.push({ ...order, source: sourceTag, savedAt: new Date().toISOString() });
    await fs.promises.writeFile(ordersPath, JSON.stringify(list, null, 2));

    await fs.promises.unlink(lockFile); // libère le verrou
    console.log(`[INFO][saveOrderLocally] Commande sauvegardée localement (${sourceTag})`);

    return { status: 'ok', local: true };
  } catch (err) {
    console.error('[ERROR][saveOrderLocally] Sauvegarde locale échouée:', err.message);
    try {
      if (fs.existsSync(`${ordersPath}.lock`)) await fs.promises.unlink(`${ordersPath}.lock`);
    } catch {}
    throw err;
  }
}
