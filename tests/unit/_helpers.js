// Utilitários compartilhados pelos testes. Importe ANTES de qualquer módulo de lib/ ou api/:
// as variáveis de ambiente abaixo precisam valer antes da primeira chamada a config()/db().
import { readFileSync } from 'node:fs';

process.env.PONTE_QUIET = '1';
process.env.DATA_MODE = 'memory';
process.env.PONTE_NO_SEED = '1';
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_MODEL;
delete process.env.ADMIN_CODE;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

export const catalog = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
export const productIds = new Set(catalog.products.map((p) => p.id));

/** Sobe o servidor local (scripts/dev.js) numa porta livre e devolve { base, close }. */
export async function startServer() {
  const prevPort = process.env.PORT;
  process.env.PORT = '0';
  const origLog = console.log;
  console.log = () => {}; // silencia "Ponte rodando em ..."
  const { default: server } = await import('../../scripts/dev.js');
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  await new Promise((r) => setTimeout(r, 10)); // deixa o callback de listen() rodar ainda silenciado
  console.log = origLog;
  if (prevPort === undefined) delete process.env.PORT; else process.env.PORT = prevPort;
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

/** Requisição JSON simples. body string = enviado como está (para testar JSON inválido). */
export async function call(base, method, path, { body, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(10_000) }; // trava vira falha, não espera infinita
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* não-JSON */ }
  return { status: res.status, headers: res.headers, json, text };
}

/** Resposta Gemini no formato do generateContent com o texto dado. */
export function geminiResponse(payload, status = 200) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status, headers: { 'content-type': 'application/json' },
  });
}

/**
 * Troca o fetch global por um falso. `responder(url, init, n)` devolve Response (ou lança).
 * Devolve { calls, restore }.
 */
export function stubFetch(responder) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    return responder(String(url), init, calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
