import './_helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { expiresAt } from '../../lib/reservations.js';
import { reservationCode, traceId } from '../../lib/codes.js';
import { createMemoryDb } from '../../lib/db-memory.js';
import { dashboard } from '../../lib/dashboard.js';
import { handler, HttpError } from '../../lib/http.js';

describe('reservations.js — validade da reserva (Palmas, UTC−3)', () => {
  test('de manhã: vale até as 22h de hoje (01h UTC do dia seguinte)', () => {
    assert.equal(expiresAt(new Date('2026-11-13T12:00:00Z')), '2026-11-14T01:00:00.000Z');
  });

  test('exatamente 2 h antes das 22h ainda vale até as 22h', () => {
    assert.equal(expiresAt(new Date('2026-11-13T23:00:00Z')), '2026-11-14T01:00:00.000Z');
  });

  test('menos de 2 h para as 22h: vale 4 h a partir de agora', () => {
    assert.equal(expiresAt(new Date('2026-11-14T00:30:00Z')), '2026-11-14T04:30:00.000Z');
  });

  test('depois das 22h: vale 4 h a partir de agora', () => {
    assert.equal(expiresAt(new Date('2026-11-14T02:00:00Z')), '2026-11-14T06:00:00.000Z');
  });

  test('logo após a meia-noite local: vale até as 22h do novo dia', () => {
    assert.equal(expiresAt(new Date('2026-11-14T03:30:00Z')), '2026-11-15T01:00:00.000Z');
  });
});

describe('codes.js — códigos', () => {
  test('código de reserva PT-1234 e traceId de 6 caracteres sem 0/O/1/I', () => {
    for (let i = 0; i < 200; i++) {
      assert.match(reservationCode(), /^PT-[1-9]\d{3}$/);
      assert.match(traceId(), /^[A-HJ-NP-Z2-9]{6}$/);
    }
  });
});

describe('db-memory.js — histórico fictício e consultas', () => {
  test('com histórico: 6 reservas da demo e eventos marcados com seed', async () => {
    const dbi = createMemoryDb({ seedHistory: true });
    for (const code of ['PT-1042', 'PT-2318', 'PT-3675', 'PT-4821', 'PT-5190', 'PT-6034']) {
      assert.ok(await dbi.getReservationByCode(code.toLowerCase()), code);
    }
    assert.equal((await dbi.getReservationByCode('PT-2318')).status, 'confirmada');
    assert.equal((await dbi.getReservationByCode('PT-2318')).store_id, 'tecnoponto');
    const events = await dbi.listEvents({ limit: 5000 });
    assert.ok(events.length >= 40);
    assert.ok(events.every((e) => e.data.seed === true));
    for (let i = 1; i < events.length; i++) assert.ok(events[i - 1].created_at >= events[i].created_at, 'mais recentes primeiro');
    assert.ok(!JSON.stringify(events).match(/Ana|Bruno|Carla|Diego|Elis|Fábio/), 'apelidos do seed fora dos eventos');
  });

  test('listStores nunca devolve o code; getStoreByCode devolve', async () => {
    const dbi = createMemoryDb({ seedHistory: false });
    for (const s of await dbi.listStores()) assert.equal(s.code, undefined);
    assert.equal((await dbi.getStoreByCode(' som112 ')).code, 'SOM112');
    assert.equal(await dbi.getStoreByCode(''), null);
  });

  test('código de reserva duplicado é recusado', async () => {
    const dbi = createMemoryDb({ seedHistory: false });
    await dbi.createReservation({ code: 'PT-1111', product_id: 'sommax-01', store_id: 'sommax', type: 'separar', nickname: 'a' });
    await assert.rejects(
      dbi.createReservation({ code: 'PT-1111', product_id: 'sommax-01', store_id: 'sommax', type: 'separar', nickname: 'b' }),
      (e) => e.code === 'duplicate',
    );
  });

  test('alterar o objeto devolvido não altera o banco', async () => {
    const dbi = createMemoryDb({ seedHistory: false });
    const r = await dbi.createReservation({ code: 'PT-2222', product_id: 'sommax-01', store_id: 'sommax', type: 'separar', nickname: 'a' });
    r.status = 'retirada';
    assert.equal((await dbi.getReservationByCode('PT-2222')).status, 'aguardando');
  });
});

describe('dashboard.js — indicadores', () => {
  test('totais, taxas e demanda não atendida a partir dos eventos', async () => {
    const dbi = createMemoryDb({ seedHistory: false });
    const add = (type, data) => dbi.addEvent({ type, trace_id: 'X', data });
    for (let i = 0; i < 4; i++) await add('busca_realizada', { term: 'fone', category: 'Fones de ouvido', results: 3 });
    await add('busca_realizada', { term: 'patinete eletrico', category: null, results: 0 });
    await add('busca_sem_resultado', { term: 'patinete eletrico', category: null });
    const ev = { store_id: 'sommax', product_id: 'sommax-01', type: 'separar' };
    await add('reserva_criada', ev);
    await add('reserva_criada', ev);
    await add('reserva_confirmada', ev);
    await add('reserva_recusada', ev);
    await add('retirada_confirmada', ev);
    await add('erro_ia', { stage: 'interpret', message: 'x' });

    const d = await dashboard(dbi);
    assert.deepEqual(d.totals, { searches: 5, searchesWithoutResult: 1, reservations: 2, confirmed: 1, refused: 1, pickedUp: 1, aiErrors: 1, apiErrors: 0 });
    assert.deepEqual(d.rates, { searchToReservation: 0.4, reservationToPickup: 0.5, confirmation: 0.5, searchWithoutResult: 0.2 });
    assert.deepEqual(d.unmetDemand, [{ term: 'patinete eletrico', category: null, count: 1 }]);
    assert.deepEqual(d.topSearches[0], { term: 'fone', category: 'Fones de ouvido', count: 4 });
    assert.equal(d.byStore[0].store.id, 'sommax');
    assert.equal(d.byStore[0].reservations, 2);
    assert.equal(d.byStore.length, 10);
    assert.equal(d.period.events, 12);
  });

  test('sem eventos: taxas zeradas, sem divisão por zero', async () => {
    const d = await dashboard(createMemoryDb({ seedHistory: false }));
    assert.deepEqual(Object.values(d.rates), [0, 0, 0, 0]);
    assert.equal(d.period.from, null);
  });
});

describe('http.js — handler no formato da Vercel (req.body já lido, req.query)', () => {
  function mockRes() {
    const res = { statusCode: 0, headers: {}, body: '' };
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.end = (b) => { res.body = b; };
    return res;
  }

  test('corpo já convertido em objeto e query prontos', async () => {
    const h = handler('teste', { POST: async ({ body, query }) => ({ eco: body.a, q: query.x }) });
    const res = mockRes();
    await h({ method: 'POST', body: { a: 1 }, query: { x: 'y' }, headers: {} }, res);
    assert.equal(res.statusCode, 200);
    const json = JSON.parse(res.body);
    assert.deepEqual({ eco: json.eco, q: json.q }, { eco: 1, q: 'y' });
    assert.equal(json.traceId, res.headers['x-trace-id']);
  });

  test('corpo string/Buffer inválido vira 400; HttpError mantém status e mensagem', async () => {
    const h = handler('teste', { POST: async () => { throw new HttpError(418, 'Sou um bule.'); } });
    for (const body of ['{x', Buffer.from('{x')]) {
      const res = mockRes();
      await h({ method: 'POST', body, headers: {} }, res);
      assert.equal(res.statusCode, 400);
    }
    const res = mockRes();
    await h({ method: 'POST', body: '', headers: {} }, res);
    assert.equal(res.statusCode, 418);
    assert.equal(JSON.parse(res.body).error.message, 'Sou um bule.');
  });
});
