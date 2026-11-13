import { handler, HttpError } from '../lib/http.js';
import { db } from '../lib/db.js';
import { event } from '../lib/logger.js';
import { requireStore } from '../lib/auth.js';
import { viewOf } from '../lib/reservations.js';

const STATUS_MSG = {
  aguardando: 'A loja ainda não confirmou esta reserva. Confirme antes da retirada.',
  recusada: 'Esta reserva foi recusada.',
  retirada: 'Esta reserva já foi retirada.',
};

export default handler('store-checkin', {
  POST: async ({ headers, body, traceId }) => {
    const store = await requireStore(headers);
    const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!code) throw new HttpError(400, 'Informe o código da reserva.');
    const reservation = await db().getReservationByCode(code);
    if (!reservation || reservation.store_id !== store.id) throw new HttpError(404, 'Reserva não encontrada nesta loja.');
    if (reservation.status !== 'confirmada') throw new HttpError(409, STATUS_MSG[reservation.status] ?? 'Reserva não pode ser retirada.');
    const updated = await db().updateReservation(reservation.id, { status: 'retirada' });
    await event('retirada_confirmada', traceId, { store_id: store.id, product_id: reservation.product_id, type: reservation.type });
    return { reservation: await viewOf(updated) };
  },
});
