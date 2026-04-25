import fs from 'fs';
import path from 'path';
import { sendToMakeWebhook } from './makeService.js';

// catalogue.json est à la RACINE du projet
const cataloguePath = path.resolve('./catalogue.json');
const dataDir       = path.resolve('./data');
const ordersPath    = path.join(dataDir, 'orders_log.json');

// ─── Lecture du catalogue ─────────────────────────────────────────────────────
export async function readCatalog() {
  try {
    if (!fs.existsSync(cataloguePath)) {
      throw new Error(`Catalogue introuvable à : ${cataloguePath}`);
    }
    const raw = await fs.promises.readFile(cataloguePath, 'utf-8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('[OrderService] ❌ Lecture catalogue :', err.message);
    throw new Error('Impossible de lire le catalogue');
  }
}

// ─── Calcul de prix ───────────────────────────────────────────────────────────
/**
 * Calcule le prix d'un article du catalogue.
 * @param {number|string} index     - Numéro N ou Désignation
 * @param {string}        priceType - NE | NS | REP
 * @param {number}        qty       - Quantité
 */
export async function computePriceFromCatalogue(index, priceType, qty = 1) {
  const items = await readCatalog();

  const item = items.find(
    (i) => Number(i.N) === Number(index) || i.Désignation === index
  );

  if (!item) return { status: 'error', message: `Article "${index}" non trouvé dans le catalogue` };

  const validTypes = ['NE', 'NS', 'REP'];
  if (!validTypes.includes(priceType)) {
    return { status: 'error', message: `Type de prix invalide "${priceType}" — utilisez NE, NS ou REP` };
  }

  const price = Number(item[priceType]);
  if (!price || isNaN(price) || price <= 0) {
    return { status: 'error', message: `Prix "${priceType}" non disponible pour "${item.Désignation}"` };
  }

  const total     = price * qty;
  const breakdown = `${qty} × ${item.Désignation} (${priceType}) = ${price} FCFA → Total : ${total} FCFA`;

  // Log fire-and-forget vers Make
  sendToMakeWebhook({ item: item.Désignation, priceType, qty, total }, 'OrderItems').catch(() => {});

  return { status: 'ok', total, breakdown, item };
}

// ─── Enregistrement de commande ───────────────────────────────────────────────
/**
 * Enregistre une commande dans Make (+ fallback local si Make indisponible).
 */
export async function addOrder(order) {
  if (!order?.ClientPhone) {
    console.warn('[OrderService] ⚠️ addOrder : ClientPhone manquant');
    return { status: 'error', message: 'ClientPhone requis' };
  }

  const enriched = {
    ...order,
    CreatedAt: order.CreatedAt || new Date().toISOString(),
    Status: order.Status || 'Pending',
  };

  if (process.env.MAKE_WEBHOOK_URL) {
    try {
      await sendToMakeWebhook({ event: 'create_order', payload: enriched }, 'Orders');
      console.log(`[OrderService] ✅ Commande envoyée à Make pour ${enriched.ClientPhone}`);
      return { status: 'ok' };
    } catch (err) {
      console.warn('[OrderService] ⚠️ Envoi Make échoué, sauvegarde locale :', err.message);
      return saveOrderLocally(enriched, '[FALLBACK Make]');
    }
  }

  return saveOrderLocally(enriched, '[MODE LOCAL]');
}

// ─── Sauvegarde locale (fallback) ─────────────────────────────────────────────
async function saveOrderLocally(order, sourceTag = '') {
  try {
    await fs.promises.mkdir(dataDir, { recursive: true });
    const lockFile = `${ordersPath}.lock`;

    if (fs.existsSync(lockFile)) {
      console.warn('[OrderService] ⚠️ Verrou détecté — sauvegarde ignorée');
      return { status: 'pending_lock' };
    }

    await fs.promises.writeFile(lockFile, Date.now().toString());

    const list = fs.existsSync(ordersPath)
      ? JSON.parse(await fs.promises.readFile(ordersPath, 'utf-8') || '[]')
      : [];

    list.push({ ...order, source: sourceTag, savedAt: new Date().toISOString() });
    await fs.promises.writeFile(ordersPath, JSON.stringify(list, null, 2));
    await fs.promises.unlink(lockFile);

    console.log(`[OrderService] ✅ Commande sauvegardée localement (${sourceTag})`);
    return { status: 'ok', local: true };
  } catch (err) {
    console.error('[OrderService] ❌ Sauvegarde locale :', err.message);
    try {
      if (fs.existsSync(`${ordersPath}.lock`)) await fs.promises.unlink(`${ordersPath}.lock`);
    } catch { /* ignore */ }
    return { status: 'error', message: 'Erreur sauvegarde locale' };
  }
}
