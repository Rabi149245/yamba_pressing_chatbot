// services/orderService.js
import fs from 'fs';
import path from 'path';
const dataDir = path.resolve('./data');
const cataloguePath = path.join(dataDir, 'catalogue.json');

/**
 * readCatalogSync / readCatalog
 */
export function readCatalogSync() {
  if (!fs.existsSync(cataloguePath)) return [];
  const raw = fs.readFileSync(cataloguePath, 'utf-8');
  return JSON.parse(raw);
}
export async function readCatalog() { return readCatalogSync(); }

/**
 * computePriceFromCatalogue(index, priceType, qty, promoPercent = 0)
 * - index: index number or designation
 * - priceType: 'NE'|'NS'|'REP'
 * - qty: integer
 * - promoPercent: optional discount percentage to apply (0-100)
 *
 * returns: { totalBeforeDiscount, discountAmount, total, breakdown, item }
 */
export async function computePriceFromCatalogue(index, priceType, qty, promoPercent = 0) {
  const items = readCatalogSync();
  const normalizedIndex = String(index).trim();
  const item = items.find(i => String(i.N) === normalizedIndex || String(i.Désignation).toLowerCase() === normalizedIndex.toLowerCase());
  if (!item) throw new Error('Item not found');

  const field = (priceType || '').toUpperCase();
  if (!['NE', 'NS', 'REP'].includes(field)) throw new Error('Invalid price type');

  const unit = Number(item[field] || item[field.toUpperCase()] || 0);
  if (isNaN(unit) || unit <= 0) throw new Error('Price not available');

  const totalBefore = unit * Number(qty);
  const discountAmount = Math.round((promoPercent || 0) * totalBefore / 100);
  const total = totalBefore - discountAmount;
  const breakdown = `${qty} x ${item.Désignation} (${field}) -> ${unit} FCFA chacun. Sous-total: ${totalBefore} FCFA. Remise: ${discountAmount} FCFA. Total: ${total} FCFA.`;
  return { totalBeforeDiscount: totalBefore, discountAmount, total, breakdown, item, unit };
}
