// Camada de dados via REST do Supabase (PostgREST), usando a chave service_role (só no servidor).
import { uuid } from './codes.js';

const CACHE_MS = 60_000;
const TIMEOUT_MS = 8_000;
const STORE_PUBLIC = 'id,name,segment,floor,unit,hours';

// PostgREST devolve numeric como número ou texto, dependendo da configuração: normaliza.
const cleanProduct = (p) => ({ ...p, price: Number(p.price), stock: Number(p.stock), tags: p.tags ?? [] });

export function createSupabaseDb({ url, key }) {
  const base = `${url}/rest/v1`;
  const cache = { stores: null, products: null, storesAt: 0, productsAt: 0 };

  async function rest(path, { method = 'GET', body, prefer = 'return=representation' } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/${path}`, {
        method,
        signal: ctrl.signal,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Prefer: prefer,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`supabase ${method} ${path.split('?')[0]} -> ${res.status}`);
        err.status = res.status;
        if (res.status === 409 || /duplicate key/i.test(text)) err.code = 'duplicate';
        throw err;
      }
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  const q = encodeURIComponent;

  async function allStores() {
    if (cache.stores && Date.now() - cache.storesAt < CACHE_MS) return cache.stores;
    const rows = await rest(`stores?select=${STORE_PUBLIC}&order=floor.asc,unit.asc`);
    cache.stores = rows;
    cache.storesAt = Date.now();
    return rows;
  }

  async function allProducts() {
    if (cache.products && Date.now() - cache.productsAt < CACHE_MS) return cache.products;
    const rows = await rest('products?select=*&order=id.asc');
    cache.products = rows.map(cleanProduct);
    cache.productsAt = Date.now();
    return cache.products;
  }

  return {
    mode: 'supabase',

    async listStores() {
      return (await allStores()).map((s) => ({ ...s }));
    },
    async getStoreByCode(code) {
      const c = String(code ?? '').trim().toUpperCase();
      if (!c) return null;
      const rows = await rest(`stores?select=*&code=eq.${q(c)}&limit=1`);
      return rows[0] ?? null;
    },
    async listProducts() {
      return allProducts();
    },
    async getProduct(id) {
      const p = (await allProducts()).find((x) => x.id === id);
      if (p) return { ...p };
      const rows = await rest(`products?select=*&id=eq.${q(id)}&limit=1`);
      return rows[0] ? cleanProduct(rows[0]) : null;
    },
    async createReservation(fields) {
      const row = {
        id: fields.id ?? uuid(),
        code: fields.code,
        product_id: fields.product_id,
        store_id: fields.store_id,
        type: fields.type,
        nickname: fields.nickname,
        status: fields.status ?? 'aguardando',
        expires_at: fields.expires_at ?? null,
      };
      const rows = await rest('reservations', { method: 'POST', body: row });
      return rows[0];
    },
    async getReservationByCode(code) {
      const c = String(code ?? '').trim().toUpperCase();
      if (!c) return null;
      const rows = await rest(`reservations?select=*&code=eq.${q(c)}&limit=1`);
      return rows[0] ?? null;
    },
    async listReservationsByStore(storeId) {
      return rest(`reservations?select=*&store_id=eq.${q(storeId)}&order=created_at.desc&limit=200`);
    },
    async updateReservation(id, patch) {
      const rows = await rest(`reservations?id=eq.${q(id)}`, {
        method: 'PATCH',
        body: { ...patch, updated_at: new Date().toISOString() },
      });
      if (!rows?.[0]) throw new Error('reserva não encontrada');
      return rows[0];
    },
    async addEvent({ type, trace_id = null, data = {} }) {
      await rest('events', { method: 'POST', body: { type, trace_id, data }, prefer: 'return=minimal' });
    },
    async listEvents({ type, trace_id, limit = 100 } = {}) {
      const parts = ['select=*', 'order=created_at.desc', `limit=${Math.max(1, Math.min(Number(limit) || 100, 5000))}`];
      if (type) parts.push(`type=eq.${q(type)}`);
      if (trace_id) parts.push(`trace_id=eq.${q(trace_id)}`);
      return rest(`events?${parts.join('&')}`);
    },
  };
}
