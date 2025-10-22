// services/orderService.js
import fs from 'fs';
import path from 'path';
const dataDir = path.resolve('./data');
const cataloguePath = path.join(dataDir, 'catalogue.json');

export function readCatalogSync() {
  if (!fs.existsSync(cataloguePath)) return [];
  const raw = fs.readFileSync(cataloguePath, 'utf-8');
  return JSON.parse(raw);
}
export async function readCatalog() {
  return readCatalogSync();
}

/**
 * computePriceFromCatalogue(index, priceType, qty)
 * index may be numeric index N or part of designation name
 * priceType: 'NE' | 'NS' | 'REP' (case-insensitive)
 */
export async function computePriceFromCatalogue(index, priceType, qty) {
  const items = readCatalogSync();
  const normalizedIndex = String(index).trim();
  const item = items.find(i => String(i.N) === normalizedIndex || String(i.Désignation).toLowerCase() === normalizedIndex.toLowerCase());
  if (!item) throw new Error('Item not found');

  const field = (priceType || '').toUpperCase();
  if (!['NE', 'NS', 'REP'].includes(field)) throw new Error('Invalid price type');

  const price = Number(item[field] || item[field.toUpperCase()] || 0);
  if (isNaN(price) || price <= 0) throw new Error('Price not available');

  const total = price * Number(qty);
  const breakdown = `${qty} x ${item.Désignation} (${field}) -> ${price} FCFA chacun`;
  return { total, breakdown, item };
}
