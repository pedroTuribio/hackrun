// Camada de dados em memória: catálogo de data/catalog.json + reservas/eventos na memória do processo.
// Usada em desenvolvimento, testes e como plano B da demo (dados somem ao reiniciar).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { uuid } from './codes.js';

const CATALOG_PATH = fileURLToPath(new URL('../data/catalog.json', import.meta.url));

const clone = (v) => structuredClone(v);
const publicStore = ({ code, ...rest }) => rest;

export function createMemoryDb({ seedHistory = process.env.PONTE_NO_SEED !== '1' } = {}) {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  const stores = catalog.stores;
  const products = catalog.products;
  const reservations = [];
  const events = [];

  const api = {
    mode: 'memory',

    async listStores() {
      return stores.map((s) => publicStore(clone(s)));
    },
    async getStoreByCode(code) {
      const c = String(code ?? '').trim().toUpperCase();
      const s = stores.find((x) => x.code === c);
      return s ? clone(s) : null;
    },
    async listProducts() {
      return products; // somente leitura: quem chama não deve alterar
    },
    async getProduct(id) {
      const p = products.find((x) => x.id === id);
      return p ? clone(p) : null;
    },
    async createReservation(fields) {
      const now = new Date().toISOString();
      const r = {
        id: fields.id ?? uuid(),
        code: fields.code,
        product_id: fields.product_id,
        store_id: fields.store_id,
        type: fields.type,
        nickname: fields.nickname,
        status: fields.status ?? 'aguardando',
        created_at: fields.created_at ?? now,
        updated_at: fields.updated_at ?? fields.created_at ?? now,
        expires_at: fields.expires_at ?? null,
      };
      if (reservations.some((x) => x.code === r.code)) {
        const err = new Error('código de reserva duplicado');
        err.code = 'duplicate';
        throw err;
      }
      reservations.push(r);
      return clone(r);
    },
    async getReservationByCode(code) {
      const c = String(code ?? '').trim().toUpperCase();
      const r = reservations.find((x) => x.code === c);
      return r ? clone(r) : null;
    },
    async listReservationsByStore(storeId) {
      return reservations
        .filter((r) => r.store_id === storeId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(clone);
    },
    async updateReservation(id, patch) {
      const r = reservations.find((x) => x.id === id);
      if (!r) throw new Error('reserva não encontrada');
      Object.assign(r, patch, { updated_at: new Date().toISOString() });
      return clone(r);
    },
    async addEvent({ type, trace_id = null, data = {}, created_at }) {
      events.push({ id: uuid(), type, trace_id, data: clone(data), created_at: created_at ?? new Date().toISOString() });
    },
    async listEvents({ type, trace_id, limit = 100 } = {}) {
      const out = [];
      for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
        const e = events[i];
        if (type && e.type !== type) continue;
        if (trace_id && e.trace_id !== trace_id) continue;
        out.push(clone(e));
      }
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
  };

  if (seedHistory) seed(api, products, reservations, events);
  return api;
}

// Histórico fictício para o painel não abrir vazio na demo (eventos marcados com data.seed = true).
function seed(api, products, reservations, events) {
  const now = Date.now();
  const H = 3600_000;
  let n = 0;
  const at = (hoursAgo) => new Date(now - hoursAgo * H).toISOString();
  const tid = () => `SEED${String(++n).padStart(2, '0')}`;
  const push = (type, hoursAgo, data, trace = tid()) =>
    events.push({ id: uuid(), type, trace_id: trace, data: { ...data, seed: true }, created_at: at(hoursAgo) });

  const searches = [
    ['fone bluetooth com cancelamento de ruido', 'Fones de ouvido', 3], ['fone bluetooth', 'Fones de ouvido', 5],
    ['tenis de corrida', 'Tênis de corrida', 4], ['tenis de corrida masculino', 'Tênis de corrida', 3],
    ['perfume amadeirado', 'Perfumes', 3], ['notebook i5', 'Notebooks', 1], ['smartwatch', 'Smartwatch', 4],
    ['air fryer', 'Eletroportáteis', 1], ['mochila notebook', 'Mochilas', 4], ['console novastation', 'Consoles', 1],
    ['caixa de som bluetooth', 'Caixas de som', 2], ['calca jeans feminina', 'Calças', 1], ['protetor solar', 'Cuidados com a pele', 1],
    ['fone bluetooth com cancelamento de ruido', 'Fones de ouvido', 3], ['tenis de corrida', 'Tênis de corrida', 4],
    ['smartwatch', 'Smartwatch', 4], ['perfume masculino', 'Perfumes', 2], ['blocos de montar', 'Brinquedos', 1],
    ['fone bluetooth', 'Fones de ouvido', 5], ['oculos de sol', 'Óculos', 1],
  ];
  const misses = [
    ['fone gamer sem fio', 'Fones de ouvido'], ['patinete eletrico', null], ['tenis de corrida feminino 36', 'Tênis de corrida'],
    ['patinete eletrico', null], ['fone gamer sem fio', 'Fones de ouvido'], ['cafeteira de capsula', 'Eletroportáteis'],
    ['patinete eletrico', null], ['tenis de corrida feminino 36', 'Tênis de corrida'],
  ];
  searches.forEach(([query, category, results], i) =>
    push('busca_realizada', 70 - i * 3.1, { query, category, results, source: i % 3 === 0 ? 'regras' : 'ia' }));
  misses.forEach(([term, category], i) => {
    const trace = tid();
    const h = 66 - i * 7.3;
    push('busca_realizada', h, { query: term, category, results: 0, source: 'ia' }, trace);
    push('busca_sem_resultado', h, { term, category }, trace);
  });
  push('erro_ia', 30, { stage: 'interpret', message: 'timeout' });

  // 6 reservas em lojas diferentes, com status variados.
  const plan = [
    ['sommax-01', 'separar', 'Ana', 'retirada', 26],
    ['tecnoponto-01', 'testar', 'Bruno', 'confirmada', 3],
    ['passofirme-01', 'testar', 'Carla', 'retirada', 22],
    ['essencia-01', 'separar', 'Diego', 'recusada', 20],
    ['arena-01', 'separar', 'Elis', 'aguardando', 1],
    ['sommax-07', 'testar', 'Fábio', 'aguardando', 0.5],
  ];
  const codes = ['PT-1042', 'PT-2318', 'PT-3675', 'PT-4821', 'PT-5190', 'PT-6034'];
  plan.forEach(([pid, type, nickname, status, hoursAgo], i) => {
    const p = products.find((x) => x.id === pid);
    const created = at(hoursAgo);
    const expires = new Date(now - hoursAgo * H + 4 * H).toISOString();
    reservations.push({
      id: uuid(), code: codes[i], product_id: p.id, store_id: p.store_id, type, nickname, status,
      created_at: created, updated_at: at(Math.max(hoursAgo - 0.3, 0)), expires_at: hoursAgo < 4 ? endOfDayIso() : expires,
    });
    const trace = tid();
    const ev = { store_id: p.store_id, product_id: p.id, type };
    push('reserva_criada', hoursAgo, ev, trace);
    if (status === 'confirmada' || status === 'retirada') push('reserva_confirmada', hoursAgo - 0.2, ev, trace);
    if (status === 'recusada') push('reserva_recusada', hoursAgo - 0.2, ev, trace);
    if (status === 'retirada') push('retirada_confirmada', hoursAgo - 1.5, ev, trace);
  });
  events.sort((a, b) => a.created_at.localeCompare(b.created_at));
  void api;
}

function endOfDayIso() {
  // 22h de hoje em Palmas (UTC-3) = 01h UTC do dia seguinte.
  const local = new Date(Date.now() - 3 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 25, 0, 0)).toISOString();
}
