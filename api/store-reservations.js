import { handler, HttpError } from '../lib/http.js';
import { db } from '../lib/db.js';
import { event } from '../lib/logger.js';
import { publicStore, requireStore } from '../lib/auth.js';
import { viewOf, viewsOf } from '../lib/reservations.js';

const ACTIONS = { confirmar: ['confirmada', 'reserva_confirmada'], recusar: ['recusada', 'reserva_recusada'] };
const STATUS_MSG = {
  confirmada: 'Esta reserva já foi confirmada.',
  recusada: 'Esta reserva já foi recusada.',
  retirada: 'Esta reserva já foi retirada.',
};

async function findOwn(store, id) {
  const list = await db().listReservationsByStore(store.id);
  return list.find((r) => r.id === id) ?? null;
}

export default handler('store-reservations', {
  GET: async ({ headers }) => {
    const store = await requireStore(headers);
    const reservations = await viewsOf(await db().listReservationsByStore(store.id));
    return { store: publicStore(store), reservations };
  },

  POST: async ({ headers, body, traceId }) => {
    const store = await requireStore(headers);
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    const action = typeof body?.action === 'string' ? body.action.trim().toLowerCase() : '';
    if (!id) throw new HttpError(400, 'Informe a reserva.');
    if (!ACTIONS[action]) throw new HttpError(400, 'Ação inválida. Use "confirmar" ou "recusar".');
    const current = await findOwn(store, id);
    if (!current) throw new HttpError(404, 'Reserva não encontrada nesta loja.');
    if (current.status !== 'aguardando') throw new HttpError(409, STATUS_MSG[current.status] ?? 'Reserva não pode mais ser alterada.');
    const [status, eventType] = ACTIONS[action];
    const updated = await db().updateReservation(current.id, { status });
    await event(eventType, traceId, { store_id: store.id, product_id: current.product_id, type: current.type });
    return { reservation: await viewOf(updated) };
  },
});
