// Roteiro de visita: agrupa produtos por loja e ordena por piso e número da loja.
import { db } from './db.js';
import { productView } from './views.js';

export async function route(productIds) {
  const [stores, products] = await Promise.all([db().listStores(), db().listProducts()]);
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const byId = new Map(products.map((p) => [p.id, p]));

  const groups = new Map();
  for (const id of new Set(productIds)) {
    const p = byId.get(id);
    const s = p && storeById.get(p.store_id);
    if (!s) continue;
    if (!groups.has(s.id)) groups.set(s.id, { store: s, products: [] });
    groups.get(s.id).products.push(productView(p, s));
  }

  const unitNum = (u) => Number.parseInt(String(u).replace(/\D/g, ''), 10) || 0;
  const ordered = [...groups.values()].sort((a, b) =>
    a.store.floor - b.store.floor || unitNum(a.store.unit) - unitNum(b.store.unit) || String(a.store.unit).localeCompare(String(b.store.unit)));

  const stops = ordered.map((g, i) => ({
    order: i + 1,
    store: { id: g.store.id, name: g.store.name, segment: g.store.segment, floor: g.store.floor, unit: g.store.unit, hours: g.store.hours },
    floor: g.store.floor,
    products: g.products,
  }));
  return { stops, summary: summarize(stops) };
}

function summarize(stops) {
  if (!stops.length) return 'Nenhuma loja no roteiro';
  const floors = [...new Set(stops.map((s) => s.floor))];
  const lojas = stops.length === 1 ? '1 loja' : `${stops.length} lojas`;
  if (floors.length === 1) return `${lojas} no piso ${floors[0]}`;
  return `${lojas} em ${floors.length} pisos`;
}
