// src/services/orderService.js
import fs from 'fs';
import path from 'path';
import { sendToMakeWebhook } from './makeService.js';

const dataDir = path.resolve('./data');
const cataloguePath = path.join(dataDir, 'catalogue.json');

// lecture asynchrone
export async function readCatalog() {
  if (!fs.existsSync(cataloguePath)) return [];
  const raw = await fs.promises.readFile(cataloguePath, 'utf-8');
  return JSON.parse(raw);
}

export async function computePriceFromCatalogue(index, priceType, qty = 1) {
  const items = await readCatalog();
  const item = items.find(i => Number(i.N) === Number(index) || i.N == index || i.Désignation == index);
  if (!item) return { status: 'error', message: 'Item not found' };

  const field = priceType === 'NE' ? 'NE' :
                priceType === 'NS' ? 'NS' :
                priceType === 'REP' ? 'REP' :
                priceType === 'AM' ? 'AM' : null;
  if (!field) return { status: 'error', message: 'Invalid price type' };

  const price = Number(item[field] || 0);
  if (isNaN(price) || price <= 0) return { status: 'error', message: 'Price not available' };

  const total = price * qty;
  const breakdown = `${qty} x ${item.Désignation} (${priceType}) -> ${price} FCFA chacun`;

  if (process.env.MAKE_WEBHOOK_URL) {
    try {
      await sendToMakeWebhook({ action: 'log_order_item', item, priceType, qty, total }, 'OrderItems');
    } catch (e) { console.warn('OrderItems log failed', e.message); }
  }

  return { status: 'ok', total, breakdown, item };
}

// addOrder that forwards to Make (and can be extended to persist locally)
export async function addOrder(order) {
  if (process.env.MAKE_WEBHOOK_URL) {
    try {
      await sendToMakeWebhook({ action: 'create_order', order }, 'Orders');
      return { status: 'ok' };
    } catch (err) {
      console.error('addOrder: sendToMakeWebhook failed', err.message);
      throw err;
    }
  } else {
    // fallback: write to local file (optional)
    try {
      const ordersPath = path.join(dataDir, 'orders_log.json');
      const list = fs.existsSync(ordersPath) ? JSON.parse(await fs.promises.readFile(ordersPath, 'utf-8')) : [];
      list.push(order);
      await fs.promises.writeFile(ordersPath, JSON.stringify(list, null, 2));
      return { status: 'ok', local: true };
    } catch (err) {
      console.error('addOrder local save failed', err.message);
      throw err;
    }
  }
}
