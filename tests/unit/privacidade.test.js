// Logs e privacidade: apelido e imagem nunca vão para eventos nem para os logs técnicos; erro 500 vira erro_api.
import { startServer, call } from './_helpers.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../lib/db.js';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv?.close(); });

const NICK = 'ApelidoSecretoZq';
const IMG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Captura tudo que vai para o console durante fn (com logs ligados). */
async function captureConsole(fn) {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const quiet = process.env.PONTE_QUIET;
  process.env.PONTE_QUIET = '0';
  console.log = console.error = console.warn = (...a) => { const l = a.join(' '); if (l.startsWith('{')) lines.push(l); };
  try {
    await fn();
  } finally {
    Object.assign(console, orig);
    process.env.PONTE_QUIET = quiet;
  }
  return lines;
}

describe('Privacidade nos eventos e logs', () => {
  test('apelido nunca aparece nos eventos nem nos logs técnicos (reserva → confirmação → retirada)', async () => {
    const lines = await captureConsole(async () => {
      const c = await call(srv.base, 'POST', '/api/reservations', { body: { productId: 'arena-01', type: 'separar', nickname: NICK } });
      assert.equal(c.status, 200);
      assert.equal(c.json.reservation.nickname, NICK, 'a própria reserva mostra o apelido para quem tem o código');
      const id = c.json.reservation.id;
      const code = c.json.reservation.code;
      const h = { 'x-store-code': 'ARE221' };
      assert.equal((await call(srv.base, 'POST', '/api/store-reservations', { headers: h, body: { id, action: 'confirmar' } })).status, 200);
      assert.equal((await call(srv.base, 'POST', '/api/store-checkin', { headers: h, body: { code } })).status, 200);
      // Erro de validação com apelido longo demais também não pode vazar o apelido.
      await call(srv.base, 'POST', '/api/reservations', { body: { productId: 'arena-01', type: 'separar', nickname: NICK.repeat(3) } });
    });
    const events = await db().listEvents({ limit: 5000 });
    const types = new Set(events.map((e) => e.type));
    for (const t of ['reserva_criada', 'reserva_confirmada', 'retirada_confirmada']) assert.ok(types.has(t), t);
    assert.ok(!JSON.stringify(events).includes(NICK), 'apelido nos eventos');
    for (const e of events.filter((x) => x.type.startsWith('reserva') || x.type === 'retirada_confirmada')) {
      assert.deepEqual(Object.keys(e.data).sort(), ['product_id', 'store_id', 'type']);
    }
    assert.ok(lines.length > 0, 'logs técnicos foram emitidos');
    assert.ok(!lines.join('\n').includes(NICK), 'apelido nos logs técnicos');
    for (const l of lines) {
      const j = JSON.parse(l);
      assert.match(j.traceId, /^[A-Z0-9]{6}$/);
      assert.ok(j.route && j.method && j.status && typeof j.ms === 'number');
    }
  });

  test('imagem nunca aparece nos eventos nem nos logs', async () => {
    const lines = await captureConsole(async () => {
      const r = await call(srv.base, 'POST', '/api/search', { body: { query: 'smartwatch', image: { mimeType: 'image/png', data: IMG } } });
      assert.equal(r.status, 200);
      await call(srv.base, 'POST', '/api/search', { body: { image: { mimeType: 'image/png', data: IMG } } }); // 400 sem IA
    });
    const events = await db().listEvents({ limit: 5000 });
    const dump = JSON.stringify(events) + lines.join('\n');
    assert.ok(!dump.includes(IMG.slice(0, 24)));
    const search = events.find((e) => e.type === 'busca_realizada' && e.data.query === 'smartwatch');
    assert.equal(search.data.hasImage, true);
    assert.deepEqual(Object.keys(search.data).sort(), ['category', 'hasImage', 'query', 'results', 'source', 'term']);
  });
});

describe('Erros inesperados (500)', () => {
  test('falha no banco vira 500 com traceId e evento erro_api', async () => {
    const dbi = db();
    const original = dbi.listProducts;
    dbi.listProducts = async () => { throw new Error('banco fora do ar (simulado)'); };
    let r;
    const lines = await captureConsole(async () => {
      r = await call(srv.base, 'POST', '/api/search', { body: { query: 'fone' } });
    });
    dbi.listProducts = original;

    assert.equal(r.status, 500);
    const trace = r.headers.get('x-trace-id');
    assert.match(trace, /^[A-Z0-9]{6}$/);
    assert.deepEqual(r.json, { error: { message: 'Erro inesperado. Informe o código de rastreio.', traceId: trace } });
    assert.ok(!r.text.includes('banco fora do ar'), 'detalhe interno não vai para o usuário');

    const evs = await dbi.listEvents({ trace_id: trace });
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, 'erro_api');
    assert.deepEqual(evs[0].data, { route: '/api/search', message: 'banco fora do ar (simulado)' });

    const errLine = lines.map((l) => JSON.parse(l)).find((j) => j.traceId === trace);
    assert.equal(errLine.level, 'error');
    assert.equal(errLine.status, 500);

    const logs = await call(srv.base, 'GET', `/api/logs?type=erro_api`, { headers: { 'x-admin-code': 'SHOP2026' } });
    assert.ok(logs.json.events.some((e) => e.trace_id === trace));
    const dash = await call(srv.base, 'GET', '/api/dashboard', { headers: { 'x-admin-code': 'SHOP2026' } });
    assert.ok(dash.json.totals.apiErrors >= 1);
  });

  test('falha ao gravar evento não derruba a requisição', async () => {
    const dbi = db();
    const original = dbi.addEvent;
    dbi.addEvent = async () => { throw new Error('tabela events indisponível'); };
    let r;
    await captureConsole(async () => {
      r = await call(srv.base, 'POST', '/api/search', { body: { query: 'fone bluetooth' } });
    });
    dbi.addEvent = original;
    assert.equal(r.status, 200);
    assert.ok(r.json.results.length > 0);
  });
});
