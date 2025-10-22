import fs from 'fs';
import path from 'path';
import { sendToMakeWebhook } from './makeService.js';

const dataDir = path.resolve('./data');
const cataloguePath = path.join(dataDir, 'catalogue.json');

// ---------------------------
// Lecture catalogue
// ---------------------------
export async function readCatalog() {
    if (!fs.existsSync(cataloguePath)) return [];
    const raw = await fs.promises.readFile(cataloguePath, 'utf-8');
    return JSON.parse(raw);
}

// ---------------------------
// Calcul du prix
// ---------------------------
export async function computePriceFromCatalogue(index, priceType, qty = 1) {
    const items = await readCatalog();
    const item = items.find(i => Number(i.N) === Number(index) || i.N == index || i.Désignation == index);
    if (!item) return { status: 'error', message: 'Item not found' };

    const field = priceType === 'NE' ? 'NE' :
                  priceType === 'NS' ? 'NS' :
                  priceType === 'REP' ? 'REP' :
                  priceType === 'AM' ? 'AM' : null; // ajout amidonnage
    if (!field) return { status: 'error', message: 'Invalid price type' };

    const price = Number(item[field] || 0);
    if (isNaN(price) || price <= 0) return { status: 'error', message: 'Price not available' };

    const total = price * qty;
    const breakdown = `${qty} x ${item.Désignation} (${priceType}) -> ${price} FCFA chacun`;

    // Enregistrement dans OrderItems (Google Sheets) via Make
    if (process.env.MAKE_WEBHOOK_URL) {
        await sendToMakeWebhook({ action: 'log_order_item', item, priceType, qty, total }, 'OrderItems');
    }

    return { status: 'ok', total, breakdown, item };
}
