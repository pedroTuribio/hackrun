import { traceId as newTraceId } from './codes.js';
import { log, event } from './logger.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
    return req.body ?? {};
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function queryOf(req) {
  if (req.query) return req.query;
  const url = new URL(req.url, 'http://localhost');
  return Object.fromEntries(url.searchParams);
}

function send(res, status, payload, trace) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('x-trace-id', trace);
  res.end(JSON.stringify(payload));
}

/**
 * Cria um handler de rota.
 * routes: { GET: async (ctx) => body, POST: async (ctx) => body }
 * ctx = { req, body, query, headers, traceId }
 * Lance HttpError(status, mensagem) para erros esperados.
 */
export function handler(name, routes) {
  return async function (req, res) {
    const trace = newTraceId();
    const started = Date.now();
    const route = `/api/${name}`;
    let status = 200;
    try {
      const fn = routes[req.method];
      if (!fn) throw new HttpError(405, 'Método não permitido.');
      let body = {};
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        try {
          body = await readBody(req);
        } catch {
          throw new HttpError(400, 'JSON inválido.');
        }
      }
      const ctx = { req, body, query: queryOf(req), headers: req.headers, traceId: trace };
      const result = (await fn(ctx)) ?? {};
      send(res, status, { ...result, traceId: trace }, trace);
      log('info', { traceId: trace, route, method: req.method, status, ms: Date.now() - started });
    } catch (err) {
      status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : 'Erro inesperado. Informe o código de rastreio.';
      send(res, status, { error: { message, traceId: trace } }, trace);
      log(status >= 500 ? 'error' : 'warn', {
        traceId: trace, route, method: req.method, status, ms: Date.now() - started, error: err.message,
      });
      if (status >= 500) await event('erro_api', trace, { route, message: err.message });
    }
  };
}
