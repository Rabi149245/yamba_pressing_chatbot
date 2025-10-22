import fs from 'fs';
import path from 'path';
import { sendToMakeWebhook } from './makeService.js';

const dataDir = path.resolve('./data');
const cataloguePath = path.join(dataDir, 'catalogue.json');

// ---------------------------
// Lecture catalogue
// ---------------------------
export function readCatalogSync() {
    if (!fs.existsSync(cataloguePath)) return [];
    const raw = fs.readFileSync(cataloguePath, 'utf-8');
    return JSON.parse(raw);
}

export async function readCatalog() {
    return readCatalogSync();
}

// ---------------------------
// Calcul du prix
// ---------------------------
export async function computePriceFromCatalogue(index, priceType, qty) {
    const items = readCatalogSync();
    const item = items.find(i => Number(i.N) === Number(index) || i.N == index || i.Désignation == index);
    if (!item) throw new Error('Item not found');

    let field = priceType === 'NE' ? 'NE' : priceType === 'NS' ? 'NS' : priceType === 'REP' ? 'REP' : null;
    if (!field) throw new Error('Invalid price type');

    const price = Number(item[field] || 0);
    if (isNaN(price) || price <= 0) throw new Error('Price not available');

    const total = price * qty;
    const breakdown = `${qty} x ${item.Désignation} (${priceType}) -> ${price} FCFA chacun`;

    // Enregistrement dans OrderItems (Google Sheets) via Make
    if (process.env.MAKE_WEBHOOK_URL) {
        await sendToMakeWebhook({ action: 'log_order_item', item, priceType, qty, total }, 'OrderItems');
    }

    return { total, breakdown, item };
}
