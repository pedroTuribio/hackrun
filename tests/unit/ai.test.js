import { productIds, geminiResponse, stubFetch } from './_helpers.js';
import { test, describe, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import * as ai from '../../lib/ai.js';
import { search } from '../../lib/search.js';
import { db } from '../../lib/db.js';

let n = 0;
const trace = () => `AIT${String(++n).padStart(3, '0')}`;
let stub = null;

before(() => { process.env.GEMINI_API_KEY = 'chave-falsa-de-teste'; });
afterEach(() => { stub?.restore(); stub = null; });

const isRank = (init) => JSON.stringify(JSON.parse(init.body).contents).includes('Candidatos:');

const INTERPRET_ANC = {
  name: 'fone bluetooth com cancelamento de ruído', category: 'Fones de ouvido', brand: null, color: 'preto',
  keywords: ['fone', 'bluetooth', 'cancelamento de ruído', 'anc'], maxPrice: null, onlinePrice: null, confidence: 'alta',
};

describe('ai.js — Gemini simulado (fetch falso)', () => {
  test('JSON válido do Gemini: source "ia" e classificação da IA', async () => {
    stub = stubFetch((url, init) => geminiResponse(isRank(init)
      ? { results: [
        { id: 'sommax-01', match: 'parecido', reason: 'Também tem ANC, outra marca' },
        { id: 'tecnoponto-01', match: 'parecido', reason: 'Também tem ANC' },
        { id: 'sommax-04', match: 'descartar', reason: 'Com fio, sem ANC' },
      ] }
      : INTERPRET_ANC));
    const r = await search({ query: 'fone com cancelamento de ruído', traceId: trace() });
    assert.equal(r.source, 'ia');
    assert.equal(r.interpreted.category, 'Fones de ouvido');
    assert.deepEqual(r.results.map((x) => x.product.id).sort(), ['sommax-01', 'tecnoponto-01']);
    assert.equal(r.results.find((x) => x.product.id === 'tecnoponto-01').reason, 'Também tem ANC');
    assert.equal(stub.calls.length, 2, 'uma chamada para interpretar e outra para classificar');
  });

  test('a chave vai no header x-goog-api-key, nunca na URL', async () => {
    stub = stubFetch((url, init) => geminiResponse(isRank(init) ? { results: [{ id: 'sommax-01', match: 'igual', reason: 'x' }] } : INTERPRET_ANC));
    await search({ query: 'fone anc', traceId: trace() });
    for (const c of stub.calls) {
      assert.ok(!c.url.includes('chave-falsa'), 'chave não pode ir na URL');
      assert.equal(c.init.headers['x-goog-api-key'], 'chave-falsa-de-teste');
      assert.match(c.url, /\/models\/gemini-flash-latest:generateContent$/);
    }
  });

  test('id inventado pela IA é descartado (resultado só do catálogo)', async () => {
    stub = stubFetch((url, init) => geminiResponse(isRank(init)
      ? { results: [
        { id: 'produto-inventado-999', match: 'igual', reason: 'Inventado' },
        { id: 'tecnoponto-01', match: 'igual', reason: 'Mesmo modelo' },
        { id: 'tecnoponto-01', match: 'parecido', reason: 'Duplicado' },
      ] }
      : INTERPRET_ANC));
    const r = await search({ query: 'fone com cancelamento de ruído', traceId: trace() });
    assert.equal(r.source, 'ia');
    assert.deepEqual(r.results.map((x) => x.product.id), ['tecnoponto-01']);
    assert.equal(r.results[0].reason, 'Mesmo modelo', 'duplicado também é ignorado');
    for (const x of r.results) assert.ok(productIds.has(x.product.id));
  });

  test('rank() direto: só aceita ids da lista de candidatos e preenche motivo vazio', async () => {
    stub = stubFetch(() => geminiResponse({ results: [
      { id: 'x-1', match: 'igual', reason: 'não existe' },
      { id: 'sommax-01', match: 'igual', reason: '' },
      { id: 'tecnoponto-01', match: 'talvez', reason: 'match inválido' },
    ] }));
    const out = await ai.rank({
      interpreted: INTERPRET_ANC,
      candidates: [{ id: 'sommax-01', name: 'A' }, { id: 'tecnoponto-01', name: 'B' }],
    });
    assert.deepEqual(out, [{ id: 'sommax-01', match: 'igual', reason: 'Mesmo produto' }]);
  });

  test('JSON malformado na interpretação: cai para regras e registra erro_ia', async () => {
    stub = stubFetch(() => geminiResponse('{"name": "fone", oops'));
    const t = trace();
    const r = await search({ query: 'fone com cancelamento de ruído', traceId: t });
    assert.equal(r.source, 'regras');
    assert.ok(r.results.length > 0, 'a busca continua funcionando');
    const evs = await db().listEvents({ trace_id: t });
    const err = evs.find((e) => e.type === 'erro_ia');
    assert.ok(err, 'evento erro_ia');
    assert.equal(err.data.stage, 'interpret');
    assert.match(err.data.message, /JSON inválido/);
    assert.equal(stub.calls.length, 1, 'não tenta classificar com a IA depois da falha');
  });

  test('JSON malformado na classificação: usa as regras para classificar e registra erro_ia (rank)', async () => {
    stub = stubFetch((url, init) => geminiResponse(isRank(init) ? 'isto não é json' : INTERPRET_ANC));
    const t = trace();
    const r = await search({ query: 'fone com cancelamento de ruído', traceId: t });
    assert.equal(r.source, 'ia', 'a interpretação foi da IA');
    assert.ok(r.results.length > 0);
    for (const x of r.results) {
      assert.ok(productIds.has(x.product.id));
      assert.ok(['igual', 'parecido'].includes(x.match));
      assert.ok(x.reason.length > 0);
    }
    const err = (await db().listEvents({ trace_id: t })).find((e) => e.type === 'erro_ia');
    assert.equal(err?.data.stage, 'rank');
  });

  test('erro HTTP (500) e falha de rede também caem para regras', async () => {
    stub = stubFetch(() => new Response('{}', { status: 500 }));
    const r1 = await search({ query: 'smartwatch', traceId: trace() });
    assert.equal(r1.source, 'regras');
    stub.restore();
    stub = stubFetch(() => { throw new TypeError('fetch failed'); });
    const r2 = await search({ query: 'smartwatch', traceId: trace() });
    assert.equal(r2.source, 'regras');
  });

  test('resposta em bloco ```json``` é aceita', async () => {
    stub = stubFetch(() => geminiResponse('```json\n' + JSON.stringify(INTERPRET_ANC) + '\n```'));
    const out = await ai.interpret({ query: 'fone anc' });
    assert.equal(out.category, 'Fones de ouvido');
    assert.equal(out.confidence, 'alta');
  });

  test('interpret(): "null" em texto vira null; confiança inválida vira "media"', async () => {
    stub = stubFetch(() => geminiResponse({ name: 'fone', category: 'Fones de ouvido', brand: 'null', color: 'N/A', keywords: ['Fone', 'fone'], confidence: 'certeza' }));
    const out = await ai.interpret({ query: 'fone' });
    assert.equal(out.brand, null);
    assert.equal(out.color, null);
    assert.deepEqual(out.keywords, ['fone']);
    assert.equal(out.confidence, 'media');
  });

  test('interpret(): preço em texto no formato brasileiro ("1.299,00", "R$ 489,90", "1.299")', async () => {
    const cases = [['1.299,00', 1299], ['R$ 489,90', 489.9], ['1.299', 1299], ['499.9', 499.9], [1299, 1299], ['grátis', null], [0, null]];
    for (const [given, want] of cases) {
      stub = stubFetch(() => geminiResponse({ name: 'notebook', keywords: ['notebook'], onlinePrice: given, maxPrice: given }));
      const out = await ai.interpret({ query: 'notebook' });
      assert.equal(out.onlinePrice, want, `onlinePrice ${JSON.stringify(given)}`);
      assert.equal(out.maxPrice, want, `maxPrice ${JSON.stringify(given)}`);
      stub.restore();
    }
    stub = null;
  });

  test('confiança baixa da IA gera aviso (warning)', async () => {
    stub = stubFetch((url, init) => geminiResponse(isRank(init)
      ? { results: [{ id: 'tecnoponto-01', match: 'parecido', reason: 'Parece ser este' }] }
      : { ...INTERPRET_ANC, confidence: 'baixa' }));
    const r = await search({ query: 'fone com cancelamento de ruído', traceId: trace() });
    assert.equal(r.confidence, 'baixa');
    assert.ok(r.warning && /Confiança baixa/.test(r.warning));
  });

  test('só foto com IA: imagem vai para o Gemini, mas não para os eventos', async () => {
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    stub = stubFetch((url, init) => geminiResponse(isRank(init)
      ? { results: [{ id: 'sommax-01', match: 'igual', reason: 'Mesmo modelo da foto' }] }
      : { ...INTERPRET_ANC, brand: 'Sonora', name: 'Fone Pulse 700' }));
    const t = trace();
    const r = await search({ query: '', image: { mimeType: 'image/png', data }, traceId: t });
    assert.equal(r.source, 'ia');
    assert.equal(r.results[0].product.id, 'sommax-01');
    assert.equal(stub.calls[0].body.contents[0].parts.at(-1).inlineData.data, data);
    const evs = await db().listEvents({ trace_id: t });
    assert.ok(evs.length > 0);
    assert.ok(!JSON.stringify(evs).includes(data.slice(0, 30)), 'imagem não aparece nos eventos');
    assert.equal(evs.find((e) => e.type === 'busca_realizada').data.hasImage, true);
  });
});
