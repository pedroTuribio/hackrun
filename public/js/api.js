// Wrapper de fetch para a API da Ponte: JSON, timeout e erro com código de rastreio.

export class ApiError extends Error {
  constructor(message, { status = 0, traceId = null, kind = 'http' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.traceId = traceId;
    this.kind = kind; // 'http' | 'timeout' | 'network'
  }
}

/**
 * Chama a API.
 * @param {string} path ex.: '/api/search'
 * @param {{ method?: string, body?: any, headers?: object, timeout?: number, query?: object }} [opts]
 */
export async function api(path, opts = {}) {
  const { method = opts.body !== undefined ? 'POST' : 'GET', body, headers = {}, query } = opts;
  const timeout = opts.timeout ?? (path.startsWith('/api/search') ? 25000 : 10000);
  let url = path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new ApiError('A resposta demorou demais. Tente de novo.', { kind: 'timeout' });
    }
    throw new ApiError('Sem conexão com o servidor. Verifique a internet e tente de novo.', { kind: 'network' });
  }
  clearTimeout(timer);
  const headerTrace = res.headers.get('x-trace-id');
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data || data.error) {
    const e = (data && data.error) || {};
    throw new ApiError(e.message || 'Algo deu errado.', {
      status: res.status,
      traceId: e.traceId || (data && data.traceId) || headerTrace || null,
    });
  }
  return data;
}
