import { catalog, productIds } from './_helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { search, interpretByRules, guessCategory } from '../../lib/search.js';
import { db } from '../../lib/db.js';
import { tokenize } from '../../lib/text.js';

let n = 0;
const trace = () => `SRCH${String(++n).padStart(2, '0')}`;
const eventsOf = (traceId) => db().listEvents({ trace_id: traceId });
const byId = new Map(catalog.products.map((p) => [p.id, p]));

/** Invariantes que TODA resposta de busca precisa cumprir. */
function assertInvariants(r) {
  assert.ok(['ia', 'regras'].includes(r.source));
  assert.ok(['alta', 'media', 'baixa'].includes(r.confidence));
  assert.ok(Array.isArray(r.results));
  assert.ok(r.results.length <= 6, 'no máximo 6 resultados');
  assert.equal(r.notFound, r.results.length === 0);
  for (const it of r.results) {
    assert.ok(productIds.has(it.product.id), `produto ${it.product.id} precisa existir no catálogo`);
    const original = byId.get(it.product.id);
    assert.equal(it.product.price, original.price, 'preço vem do catálogo, nunca inventado');
    assert.equal(it.product.stock, original.stock, 'estoque vem do catálogo');
    assert.ok(it.product.stock > 0, 'não mostra produto sem estoque');
    assert.ok(['igual', 'parecido'].includes(it.match));
    assert.equal(typeof it.reason, 'string');
    assert.ok(it.reason.trim().length > 0, 'todo resultado tem motivo');
    assert.ok(it.reason.length <= 80);
    assert.equal(it.product.store.id, original.store_id);
    assert.equal(it.product.store.code, undefined, 'código da loja nunca aparece');
  }
  if (r.warning) assert.equal(r.confidence, 'baixa');
}

describe('search.js — consultas da demonstração (modo regras)', () => {
  test('"fone com cancelamento de ruído" traz os fones com ANC da SomMax e da TecnoPonto', async () => {
    const t = trace();
    const r = await search({ query: 'fone com cancelamento de ruído', traceId: t });
    assertInvariants(r);
    assert.equal(r.source, 'regras');
    assert.equal(r.interpreted.category, 'Fones de ouvido');
    const ids = r.results.map((x) => x.product.id);
    assert.ok(ids.includes('sommax-01'), 'SomMax (Pulse 700)');
    assert.ok(ids.includes('tecnoponto-01'), 'TecnoPonto (Q45)');
    const stores = new Set(r.results.map((x) => x.product.store.name));
    assert.ok(stores.has('SomMax') && stores.has('TecnoPonto'));
    for (const x of r.results) assert.ok(x.product.tags.includes('anc'), `${x.product.id} deveria ter ANC`);
    assert.equal(r.comparison, null, 'sem preço online, não há comparativo');

    const evs = await eventsOf(t);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, 'busca_realizada');
    assert.equal(evs[0].data.results, r.results.length);
    assert.equal(evs[0].data.hasImage, false);
    assert.equal(evs[0].data.source, 'regras');
  });

  test('"tênis de corrida até 400" respeita o preço máximo e ignora estoque zerado', async () => {
    const r = await search({ query: 'tênis de corrida até 400', traceId: trace() });
    assertInvariants(r);
    assert.equal(r.interpreted.maxPrice, 400);
    assert.equal(r.interpreted.category, 'Tênis de corrida');
    assert.ok(r.results.length > 0);
    for (const x of r.results) {
      assert.ok(x.product.price <= 400, `${x.product.name} custa ${x.product.price}`);
      assert.ok(x.product.stock > 0);
    }
    const ids = r.results.map((x) => x.product.id);
    assert.ok(!ids.includes('passofirme-02'), 'Run 2 Feminino está com estoque 0');
  });

  test('"patinete elétrico" não acha nada e registra busca_sem_resultado', async () => {
    const t = trace();
    const r = await search({ query: 'patinete elétrico', traceId: t });
    assertInvariants(r);
    assert.equal(r.notFound, true);
    assert.deepEqual(r.results, []);
    assert.equal(r.comparison, null);
    assert.equal(r.warning, null);
    const evs = await eventsOf(t);
    const miss = evs.find((e) => e.type === 'busca_sem_resultado');
    assert.ok(miss, 'evento busca_sem_resultado');
    assert.equal(miss.data.term, 'patinete eletrico');
    const done = evs.find((e) => e.type === 'busca_realizada');
    assert.equal(done.data.results, 0);
  });

  test('marca + modelo citados viram "igual", com comparativo honesto quando o online é mais barato', async () => {
    const r = await search({ query: 'fone Sonora Pulse 700 R$ 489,90', traceId: trace() });
    assertInvariants(r);
    assert.equal(r.results[0].product.id, 'sommax-01');
    assert.equal(r.results[0].match, 'igual');
    assert.equal(r.interpreted.onlinePrice, 489.9);
    const c = r.comparison;
    assert.ok(c);
    assert.equal(c.basis, 'igual');
    assert.equal(c.shoppingPrice, 499);
    assert.equal(c.shippingEstimate, 0);
    assert.equal(c.difference, 9.1);
    assert.equal(c.verdict, 'online_mais_barato');
    assert.ok(!c.advantages.some((a) => /mais barato no shopping/.test(a)), 'não pode dizer que o shopping é mais barato');
    assert.equal(c.alternative?.productId, 'tecnoponto-01', 'mostra o parecido mais barato em outra loja');
  });

  test('produto "igual" mais barato no shopping', async () => {
    const r = await search({ query: 'headphone Auralis Q45 R$ 520,00', traceId: trace() });
    assertInvariants(r);
    assert.equal(r.results[0].product.id, 'tecnoponto-01');
    assert.equal(r.results[0].match, 'igual');
    assert.equal(r.comparison.verdict, 'shopping_mais_barato');
    assert.equal(r.comparison.difference, -61);
  });

  test('"sem fio" não traz fone com fio', async () => {
    const r = await search({ query: 'fone sem fio', traceId: trace() });
    assertInvariants(r);
    assert.ok(r.results.length > 0);
    for (const x of r.results) assert.ok(!x.product.tags.includes('com fio'), x.product.name);
  });

  test('várias consultas variadas cumprem as invariantes', async () => {
    const queries = ['perfume amadeirado', 'notebook i5', 'smartwatch', 'air fryer', 'mochila para notebook', 'caixa de som bluetooth',
      'fone bluetooth', 'tenis', 'calça jeans', 'protetor solar', 'livro', 'xyzabc', 'bicicleta', 'console', 'tênis de corrida feminino'];
    for (const q of queries) assertInvariants(await search({ query: q, traceId: trace() }));
  });

  test('só foto e sem IA: erro 400 pedindo para escrever o nome', async () => {
    await assert.rejects(
      search({ query: '', image: { mimeType: 'image/png', data: 'iVBORw0KGgo=' }, traceId: trace() }),
      (err) => err.status === 400 && /Escreva o nome do produto/.test(err.message),
    );
  });

  test('texto + foto sem IA: busca pelo texto e não grava a imagem no evento', async () => {
    const t = trace();
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk';
    const r = await search({ query: 'smartwatch', image: { mimeType: 'image/png', data }, traceId: t });
    assertInvariants(r);
    const evs = await eventsOf(t);
    assert.equal(evs[0].data.hasImage, true);
    assert.ok(!JSON.stringify(evs).includes(data), 'imagem não pode ir para o evento');
  });
});

describe('search.js — interpretação por regras', () => {
  test('categoria pela primeira palavra que define o produto', () => {
    assert.equal(guessCategory(tokenize('mochila para notebook')), 'Mochilas');
    assert.equal(guessCategory(tokenize('tênis de corrida')), 'Tênis de corrida');
    assert.equal(guessCategory(tokenize('headphone')), 'Fones de ouvido');
    assert.equal(guessCategory(tokenize('qualquer coisa')), null);
  });

  test('marca, cor e preço extraídos do texto', () => {
    const products = catalog.products;
    const r = interpretByRules('fone Sonora preta até 500', products, []);
    assert.equal(r.brand, 'Sonora');
    assert.equal(r.color, 'Preto');
    assert.equal(r.maxPrice, 500);
  });
});
