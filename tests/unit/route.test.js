import './_helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../../lib/route.js';

describe('route.js — roteiro de visita', () => {
  test('ordena por piso e número da loja', async () => {
    // TecnoPonto (2/204), Lar & Cia (3/305), Passo Firme (1/125), SomMax (1/112)
    const r = await route(['tecnoponto-01', 'larecia-01', 'passofirme-01', 'sommax-01']);
    assert.deepEqual(r.stops.map((s) => s.store.name), ['SomMax', 'Passo Firme', 'TecnoPonto', 'Lar & Cia']);
    assert.deepEqual(r.stops.map((s) => s.order), [1, 2, 3, 4]);
    assert.deepEqual(r.stops.map((s) => s.floor), [1, 1, 2, 3]);
    assert.equal(r.summary, '4 lojas em 3 pisos');
  });

  test('agrupa vários produtos da mesma loja numa parada só', async () => {
    const r = await route(['sommax-01', 'tecnoponto-01', 'sommax-03', 'sommax-01']);
    assert.equal(r.stops.length, 2);
    const som = r.stops[0];
    assert.equal(som.store.id, 'sommax');
    assert.deepEqual(som.products.map((p) => p.id), ['sommax-01', 'sommax-03'], 'sem repetir produto');
    assert.equal(som.products[0].store.name, 'SomMax', 'ProductView traz a loja');
    assert.equal(r.summary, '2 lojas em 2 pisos');
  });

  test('parada traz horário e não traz o código da loja', async () => {
    const r = await route(['arena-01']);
    assert.ok(r.stops[0].store.hours);
    assert.equal(r.stops[0].store.code, undefined);
    assert.equal(JSON.stringify(r).includes('ARE221'), false);
    assert.equal(r.summary, '1 loja no piso 2');
  });

  test('várias lojas no mesmo piso', async () => {
    const r = await route(['passofirme-01', 'vitrine-01', 'sommax-01']);
    assert.deepEqual(r.stops.map((s) => String(s.store.unit)), ['112', '118', '125']);
    assert.deepEqual(r.stops.map((s) => s.store.name), ['SomMax', 'Vitrine Moda', 'Passo Firme']);
    assert.equal(r.summary, '3 lojas no piso 1');
  });

  test('ids desconhecidos são ignorados; nenhum válido = roteiro vazio', async () => {
    const r = await route(['nao-existe', 'sommax-01']);
    assert.equal(r.stops.length, 1);
    const empty = await route(['nao-existe']);
    assert.deepEqual(empty.stops, []);
    assert.equal(empty.summary, 'Nenhuma loja no roteiro');
  });
});
