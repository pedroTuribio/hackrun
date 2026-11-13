import { handler, HttpError } from '../lib/http.js';
import { db } from '../lib/db.js';
import { requireAdmin } from '../lib/auth.js';

const TYPES = ['busca_realizada', 'busca_sem_resultado', 'reserva_criada', 'reserva_confirmada',
  'reserva_recusada', 'retirada_confirmada', 'erro_ia', 'erro_api'];

export default handler('logs', {
  GET: async ({ headers, query }) => {
    requireAdmin(headers);
    const type = String(query.type ?? '').trim();
    const trace = String(query.trace ?? '').trim().toUpperCase();
    const limit = Math.max(1, Math.min(Number.parseInt(query.limit, 10) || 100, 500));
    if (type && !TYPES.includes(type)) throw new HttpError(400, 'Tipo de evento inválido.');
    if (trace && !/^[A-Z0-9]{1,12}$/.test(trace)) throw new HttpError(400, 'Código de rastreio inválido.');
    const events = await db().listEvents({ type: type || undefined, trace_id: trace || undefined, limit });
    return { events };
  },
});
