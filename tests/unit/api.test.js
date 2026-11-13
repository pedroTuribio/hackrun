// Integração: servidor local real (scripts/dev.js) numa porta livre, chamadas HTTP de verdade.
import { startServer, call, productIds } from './_helpers.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv?.close(); });

const TRACE_RE = /^[A-Z0-9]{6}$/;

/** Chama a API e confere o contrato comum: traceId no corpo e no header; formato de erro. */
async function api(method, path, opts) {
  const r = await call(srv.base, method, path, opts);
  assert.ok(r.json, `${method} ${path}: resposta precisa ser JSON (veio ${r.text.slice(0, 80)})`);
  const header = r.headers.get('x-trace-id');
  assert.match(header ?? '', TRACE_RE, `${method} ${path}: header x-trace-id`);
  assert.match(r.headers.get('content-type'), /application\/json/);
  if (r.status >= 400) {
    assert.deepEqual(Object.keys(r.json), ['error'], `${method} ${path}: erro só com { error }`);
    assert.equal(typeof r.json.error.message, 'string');
    assert.ok(r.json.error.message.length > 0);
    assert.equal(r.json.error.traceId, header, 'traceId do erro = header');
  } else {
    assert.equal(r.json.traceId, header, `${method} ${path}: traceId do corpo = header`);
  }
  return r;
}

const store = (code) => ({ 'x-store-code': code });
const admin = (code = 'SHOP2026') => ({ 'x-admin-code': code });

describe('API — fluxo completo da demonstração', () => {
  const state = {};

  test('health informa modo memória e regras', async () => {
    const r = await api('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.mode, { data: 'memory', ai: 'regras' });
  });

  test('stores lista as 10 lojas sem código de acesso', async () => {
    const r = await api('GET', '/api/stores');
    assert.equal(r.json.stores.length, 10);
    for (const s of r.json.stores) assert.equal(s.code, undefined);
    assert.ok(!r.text.includes('SOM112'));
  });

  test('1. busca encontra o fone com ANC da TecnoPonto', async () => {
    const r = await api('POST', '/api/search', { body: { query: 'fone com cancelamento de ruído' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.source, 'regras');
    const hit = r.json.results.find((x) => x.product.id === 'tecnoponto-01');
    assert.ok(hit);
    for (const x of r.json.results) assert.ok(productIds.has(x.product.id));
    state.searchTrace = r.json.traceId;
  });

  test('2. produto e parecidos', async () => {
    const r = await api('GET', '/api/product?id=tecnoponto-01');
    assert.equal(r.json.product.store.name, 'TecnoPonto');
    assert.ok(r.json.similar.length > 0);
    for (const p of r.json.similar) {
      assert.equal(p.category, r.json.product.category);
      assert.ok(p.stock > 0);
    }
  });

  test('3. cria a reserva (POST /api/reservations)', async () => {
    const r = await api('POST', '/api/reservations', { body: { productId: 'tecnoponto-01', type: 'Testar', nickname: '  Joana   QA ' } });
    assert.equal(r.status, 200);
    const res = r.json.reservation;
    assert.match(res.code, /^PT-\d{4}$/);
    assert.equal(res.status, 'aguardando');
    assert.equal(res.type, 'testar');
    assert.equal(res.nickname, 'Joana QA', 'apelido limpo (trim e espaços)');
    assert.equal(res.store_id, 'tecnoponto');
    assert.equal(res.product.id, 'tecnoponto-01');
    assert.equal(res.product.store.name, 'TecnoPonto');
    assert.ok(new Date(res.expires_at) > new Date(res.created_at));
    state.reservation = res;
    state.reserveTrace = r.json.traceId;
  });

  test('4. consulta a reserva pelo código (sem diferenciar maiúsculas)', async () => {
    const r = await api('GET', `/api/reservations?code=${state.reservation.code.toLowerCase()}`);
    assert.equal(r.json.reservation.id, state.reservation.id);
    assert.equal(r.json.reservation.status, 'aguardando');
  });

  test('5. login da loja devolve a loja sem o código', async () => {
    const r = await api('POST', '/api/store-login', { body: { code: 'tec204' } });
    assert.equal(r.json.store.id, 'tecnoponto');
    assert.equal(r.json.store.code, undefined);
  });

  test('6. loja vê a reserva na lista', async () => {
    const r = await api('GET', '/api/store-reservations', { headers: store('TEC204') });
    assert.equal(r.json.store.code, undefined);
    const mine = r.json.reservations.find((x) => x.id === state.reservation.id);
    assert.ok(mine);
    assert.equal(mine.product.name, state.reservation.product.name);
    for (const x of r.json.reservations) assert.equal(x.store_id, 'tecnoponto');
  });

  test('7. retirada antes da confirmação: 409', async () => {
    const r = await api('POST', '/api/store-checkin', { headers: store('TEC204'), body: { code: state.reservation.code } });
    assert.equal(r.status, 409);
    assert.match(r.json.error.message, /ainda não confirmou/);
  });

  test('8. reserva de outra loja: 404 (confirmar e retirar)', async () => {
    const a = await api('POST', '/api/store-reservations', { headers: store('SOM112'), body: { id: state.reservation.id, action: 'confirmar' } });
    assert.equal(a.status, 404);
    const b = await api('POST', '/api/store-checkin', { headers: store('SOM112'), body: { code: state.reservation.code } });
    assert.equal(b.status, 404);
  });

  test('9. loja confirma; confirmar de novo dá 409', async () => {
    const r = await api('POST', '/api/store-reservations', { headers: store('TEC204'), body: { id: state.reservation.id, action: 'confirmar' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.reservation.status, 'confirmada');
    state.confirmTrace = r.json.traceId;
    const again = await api('POST', '/api/store-reservations', { headers: store('TEC204'), body: { id: state.reservation.id, action: 'recusar' } });
    assert.equal(again.status, 409);
  });

  test('10. check-in: reserva retirada; retirar de novo dá 409', async () => {
    const r = await api('POST', '/api/store-checkin', { headers: store('TEC204'), body: { code: ` ${state.reservation.code.toLowerCase()} ` } });
    assert.equal(r.status, 200);
    assert.equal(r.json.reservation.status, 'retirada');
    const again = await api('POST', '/api/store-checkin', { headers: store('TEC204'), body: { code: state.reservation.code } });
    assert.equal(again.status, 409);
    const view = await api('GET', `/api/reservations?code=${state.reservation.code}`);
    assert.equal(view.json.reservation.status, 'retirada');
  });

  test('11. painel reflete busca, reserva, confirmação e retirada', async () => {
    const r = await api('GET', '/api/dashboard', { headers: admin('shop2026') });
    const t = r.json.totals;
    assert.ok(t.searches >= 1);
    assert.equal(t.reservations, 1);
    assert.equal(t.confirmed, 1);
    assert.equal(t.pickedUp, 1);
    assert.equal(t.refused, 0);
    assert.equal(r.json.rates.reservationToPickup, 1);
    assert.equal(r.json.rates.confirmation, 1);
    const tec = r.json.byStore.find((s) => s.store.id === 'tecnoponto');
    assert.deepEqual({ ...tec, store: undefined }, { store: undefined, reservations: 1, confirmed: 1, refused: 0, pickedUp: 1 });
    assert.equal(r.json.byStore[0].store.id, 'tecnoponto', 'loja com mais reservas primeiro');
    assert.ok(r.json.topSearches.some((s) => s.term === 'fone com cancelamento de ruido'));
  });

  test('12. logs filtram pelo código de rastreio', async () => {
    const r = await api('GET', `/api/logs?trace=${state.reserveTrace.toLowerCase()}`, { headers: admin() });
    assert.equal(r.json.events.length, 1);
    assert.equal(r.json.events[0].type, 'reserva_criada');
    assert.equal(r.json.events[0].trace_id, state.reserveTrace);
    assert.deepEqual(r.json.events[0].data, { store_id: 'tecnoponto', product_id: 'tecnoponto-01', type: 'testar' });

    const byType = await api('GET', '/api/logs?type=retirada_confirmada&limit=5', { headers: admin() });
    assert.equal(byType.json.events.length, 1);
    const s = await api('GET', `/api/logs?trace=${state.searchTrace}`, { headers: admin() });
    assert.deepEqual(s.json.events.map((e) => e.type), ['busca_realizada']);
  });

  test('13. roteiro com os produtos escolhidos', async () => {
    const r = await api('POST', '/api/route', { body: { productIds: ['tecnoponto-01', 'sommax-01', 'nao-existe'] } });
    assert.equal(r.json.summary, '2 lojas em 2 pisos');
    assert.equal(r.json.stops[0].store.name, 'SomMax');
  });
});

describe('API — caminhos de erro', () => {
  test('405 método não permitido', async () => {
    const r = await api('GET', '/api/search');
    assert.equal(r.status, 405);
    const d = await api('DELETE', '/api/reservations');
    assert.equal(d.status, 405);
  });

  test('400 JSON inválido', async () => {
    for (const path of ['/api/search', '/api/reservations', '/api/store-login', '/api/route']) {
      const r = await api('POST', path, { body: '{"query": "fone",' });
      assert.equal(r.status, 400, path);
      assert.equal(r.json.error.message, 'JSON inválido.');
    }
  });

  test('400 busca vazia, busca não-texto e imagem em formato errado', async () => {
    assert.equal((await api('POST', '/api/search', { body: {} })).status, 400);
    assert.equal((await api('POST', '/api/search', { body: { query: '   ' } })).status, 400);
    assert.equal((await api('POST', '/api/search', { body: { query: 123 } })).status, 400);
    assert.equal((await api('POST', '/api/search', { body: [] })).status, 400);
    const gif = await api('POST', '/api/search', { body: { image: { mimeType: 'image/gif', data: 'R0lGODlh' } } });
    assert.equal(gif.status, 400);
    assert.match(gif.json.error.message, /JPG, PNG ou WEBP/);
    const bad = await api('POST', '/api/search', { body: { image: { mimeType: 'image/png', data: 'não é base64!' } } });
    assert.equal(bad.status, 400);
  });

  test('400 só foto sem IA: pede para escrever o nome (aceita data URL)', async () => {
    const r = await api('POST', '/api/search', { body: { image: { data: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' } } });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /Escreva o nome do produto/);
  });

  test('413 imagem maior que 3 MB', async () => {
    const data = 'A'.repeat(Math.ceil((3 * 1024 * 1024 + 10) / 3) * 4);
    const r = await api('POST', '/api/search', { body: { query: 'fone', image: { mimeType: 'image/jpeg', data } } });
    assert.equal(r.status, 413);
    assert.match(r.json.error.message, /3 MB/);
  });

  test('400 reserva com dados inválidos; 404 produto inexistente; 409 sem estoque', async () => {
    const base = { productId: 'sommax-01', type: 'separar', nickname: 'Ana' };
    assert.equal((await api('POST', '/api/reservations', { body: { ...base, type: 'comprar' } })).status, 400);
    assert.equal((await api('POST', '/api/reservations', { body: { ...base, nickname: '   ' } })).status, 400);
    assert.equal((await api('POST', '/api/reservations', { body: { ...base, nickname: 'x'.repeat(31) } })).status, 400);
    assert.equal((await api('POST', '/api/reservations', { body: { ...base, nickname: 'x'.repeat(30) } })).status, 200);
    assert.equal((await api('POST', '/api/reservations', { body: { ...base, productId: '' } })).status, 400);
    assert.equal((await api('POST', '/api/reservations', { body: { ...base, productId: 'nao-existe' } })).status, 404);
    const out = await api('POST', '/api/reservations', { body: { ...base, productId: 'sommax-02' } });
    assert.equal(out.status, 409);
    assert.match(out.json.error.message, /sem estoque/);
  });

  test('404 reserva inexistente; 400 sem código', async () => {
    assert.equal((await api('GET', '/api/reservations?code=PT-0000')).status, 404);
    assert.equal((await api('GET', '/api/reservations')).status, 400);
  });

  test('401 código de loja errado ou ausente', async () => {
    assert.equal((await api('POST', '/api/store-login', { body: { code: 'ERRADO' } })).status, 401);
    assert.equal((await api('POST', '/api/store-login', { body: { code: '' } })).status, 400);
    assert.equal((await api('GET', '/api/store-reservations')).status, 401);
    assert.equal((await api('GET', '/api/store-reservations', { headers: store('XYZ999') })).status, 401);
    assert.equal((await api('POST', '/api/store-checkin', { headers: store('XYZ999'), body: { code: 'PT-1042' } })).status, 401);
  });

  test('401 código de administração errado ou ausente', async () => {
    assert.equal((await api('GET', '/api/dashboard')).status, 401);
    assert.equal((await api('GET', '/api/dashboard', { headers: admin('SHOP2025') })).status, 401);
    assert.equal((await api('GET', '/api/dashboard', { headers: admin('SHOP') })).status, 401);
    assert.equal((await api('GET', '/api/logs', { headers: admin('nada') })).status, 401);
  });

  test('400 ação inválida na loja; 404 reserva inexistente', async () => {
    assert.equal((await api('POST', '/api/store-reservations', { headers: store('SOM112'), body: { id: 'x', action: 'apagar' } })).status, 400);
    assert.equal((await api('POST', '/api/store-reservations', { headers: store('SOM112'), body: { id: 'nao-existe', action: 'confirmar' } })).status, 404);
    assert.equal((await api('POST', '/api/store-checkin', { headers: store('SOM112'), body: {} })).status, 400);
  });

  test('loja recusa reserva aguardando; retirar recusada dá 409', async () => {
    const c = await api('POST', '/api/reservations', { body: { productId: 'sommax-03', type: 'separar', nickname: 'Rui' } });
    const r = await api('POST', '/api/store-reservations', { headers: store('SOM112'), body: { id: c.json.reservation.id, action: 'recusar' } });
    assert.equal(r.json.reservation.status, 'recusada');
    const k = await api('POST', '/api/store-checkin', { headers: store('SOM112'), body: { code: c.json.reservation.code } });
    assert.equal(k.status, 409);
    assert.match(k.json.error.message, /recusada/);
  });

  test('logs: 400 para tipo desconhecido ou rastreio inválido; limite respeitado', async () => {
    assert.equal((await api('GET', '/api/logs?type=hackear', { headers: admin() })).status, 400);
    assert.equal((await api('GET', '/api/logs?trace=%3Cscript%3E', { headers: admin() })).status, 400);
    const r = await api('GET', '/api/logs?limit=2', { headers: admin() });
    assert.equal(r.json.events.length, 2);
    const big = await api('GET', '/api/logs?limit=99999', { headers: admin() });
    assert.ok(big.json.events.length <= 500);
  });

  test('roteiro: 400 lista vazia, não-lista, >20 itens; 404 nenhum produto existe', async () => {
    assert.equal((await api('POST', '/api/route', { body: { productIds: [] } })).status, 400);
    assert.equal((await api('POST', '/api/route', { body: { productIds: 'sommax-01' } })).status, 400);
    assert.equal((await api('POST', '/api/route', { body: { productIds: [1, 2] } })).status, 400);
    assert.equal((await api('POST', '/api/route', { body: { productIds: Array(21).fill('sommax-01') } })).status, 400);
    assert.equal((await api('POST', '/api/route', { body: { productIds: ['nao-existe'] } })).status, 404);
  });

  test('produto: 400 sem id, 404 inexistente', async () => {
    assert.equal((await api('GET', '/api/product')).status, 400);
    assert.equal((await api('GET', '/api/product?id=nao-existe')).status, 404);
  });

  test('cada requisição recebe um traceId diferente', async () => {
    const ids = new Set();
    for (let i = 0; i < 5; i++) ids.add((await api('GET', '/api/health')).json.traceId);
    assert.equal(ids.size, 5);
  });
});
