// Camada Supabase com fetch falso: confere URLs, headers e conversões sem precisar de rede.
import { stubFetch } from './_helpers.js';
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseDb } from '../../lib/db-supabase.js';
import { config } from '../../lib/config.js';

const URL_ = 'https://exemplo.supabase.co';
const KEY = 'service-role-falsa';
let stub = null;
afterEach(() => { stub?.restore(); stub = null; });

const json = (body, status = 200) => new Response(body == null ? '' : JSON.stringify(body), { status });

describe('db-supabase.js — REST do Supabase (fetch simulado)', () => {
  test('envia a chave nos headers e usa /rest/v1', async () => {
    stub = stubFetch(() => json([]));
    const dbi = createSupabaseDb({ url: URL_, key: KEY });
    assert.equal(dbi.mode, 'supabase');
    await dbi.listStores();
    const c = stub.calls[0];
    assert.match(c.url, /^https:\/\/exemplo\.supabase\.co\/rest\/v1\/stores\?select=id,name,segment,floor,unit,hours/);
    assert.ok(!c.url.includes('code'), 'listStores não pede o código da loja');
    assert.equal(c.init.headers.apikey, KEY);
    assert.equal(c.init.headers.Authorization, `Bearer ${KEY}`);
  });

  test('preço e estoque em texto viram número; tags nulas viram lista', async () => {
    stub = stubFetch(() => json([{ id: 'p1', price: '499.90', stock: '3', tags: null }]));
    const dbi = createSupabaseDb({ url: URL_, key: KEY });
    const [p] = await dbi.listProducts();
    assert.equal(p.price, 499.9);
    assert.equal(p.stock, 3);
    assert.deepEqual(p.tags, []);
    await dbi.listProducts();
    assert.equal(stub.calls.length, 1, 'catálogo fica em cache');
  });

  test('busca por código: maiúsculas e escape na URL', async () => {
    stub = stubFetch(() => json([]));
    const dbi = createSupabaseDb({ url: URL_, key: KEY });
    assert.equal(await dbi.getReservationByCode(' pt-1234 '), null);
    assert.match(stub.calls[0].url, /code=eq\.PT-1234&limit=1$/);
    await dbi.getStoreByCode('a&b=c');
    assert.match(stub.calls[1].url, /code=eq\.A%26B%3DC&/);
    assert.equal(await dbi.getStoreByCode(''), null);
    assert.equal(stub.calls.length, 2, 'código vazio nem consulta');
  });

  test('409 / duplicate key vira err.code = "duplicate" (o handler tenta outro código)', async () => {
    stub = stubFetch(() => new Response('{"message":"duplicate key value violates unique constraint"}', { status: 409 }));
    const dbi = createSupabaseDb({ url: URL_, key: KEY });
    await assert.rejects(dbi.createReservation({ code: 'PT-1', product_id: 'p', store_id: 's', type: 'separar', nickname: 'a' }),
      (e) => e.code === 'duplicate' && e.status === 409);
  });

  test('erro HTTP não expõe a chave na mensagem', async () => {
    stub = stubFetch(() => new Response('falhou', { status: 500 }));
    const dbi = createSupabaseDb({ url: URL_, key: KEY });
    await assert.rejects(dbi.listEvents({ type: 'erro_api' }), (e) => /supabase GET events -> 500/.test(e.message) && !e.message.includes(KEY));
    assert.match(stub.calls[0].url, /type=eq\.erro_api/);
  });

  test('addEvent usa return=minimal; listEvents limita a 5000', async () => {
    stub = stubFetch(() => json(null, 201));
    const dbi = createSupabaseDb({ url: URL_, key: KEY });
    await dbi.addEvent({ type: 'busca_realizada', trace_id: 'ABC123', data: { results: 1 } });
    assert.equal(stub.calls[0].init.headers.Prefer, 'return=minimal');
    assert.deepEqual(stub.calls[0].body, { type: 'busca_realizada', trace_id: 'ABC123', data: { results: 1 } });
    stub.restore();
    stub = stubFetch(() => json([]));
    await dbi.listEvents({ limit: 99999 });
    assert.match(stub.calls[0].url, /limit=5000/);
  });

  test('updateReservation sem linha devolvida: erro', async () => {
    stub = stubFetch(() => json([]));
    const dbi = createSupabaseDb({ url: URL_, key: KEY });
    await assert.rejects(dbi.updateReservation('x', { status: 'confirmada' }), /não encontrada/);
    assert.equal(stub.calls[0].init.method, 'PATCH');
  });
});

describe('config.js — modos', () => {
  test('Supabase só com URL e chave; DATA_MODE=memory força memória', () => {
    const saved = { ...process.env };
    try {
      process.env.SUPABASE_URL = URL_ + '/';
      process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
      delete process.env.DATA_MODE;
      assert.equal(config().dataMode, 'supabase');
      assert.equal(config().supabaseUrl, URL_, 'barra final removida');
      process.env.DATA_MODE = 'memory';
      assert.equal(config().dataMode, 'memory');
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.DATA_MODE;
      assert.equal(config().dataMode, 'memory');
      assert.equal(config().aiMode, 'regras');
      assert.equal(config().geminiModel, 'gemini-flash-latest');
      assert.equal(config().adminCode, 'SHOP2026');
    } finally {
      for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATA_MODE']) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  });
});
