import { handler, HttpError } from '../lib/http.js';
import { db } from '../lib/db.js';
import { event } from '../lib/logger.js';
import { expiresAt, uniqueCode, viewOf } from '../lib/reservations.js';

const TYPES = ['separar', 'testar'];

export default handler('reservations', {
  POST: async ({ body, traceId }) => {
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
    const type = typeof body?.type === 'string' ? body.type.trim().toLowerCase() : '';
    const nickname = typeof body?.nickname === 'string' ? body.nickname.trim().replace(/\s+/g, ' ') : '';
    if (!productId) throw new HttpError(400, 'Informe o produto.');
    if (!TYPES.includes(type)) throw new HttpError(400, 'Escolha "separar" ou "testar".');
    if (nickname.length < 1 || nickname.length > 30) throw new HttpError(400, 'Informe um apelido de 1 a 30 caracteres.');

    const product = await db().getProduct(productId);
    if (!product) throw new HttpError(404, 'Produto não encontrado.');
    if (!(product.stock > 0)) throw new HttpError(409, 'Este produto está sem estoque nesta loja.');

    let reservation = null;
    for (let i = 0; i < 3 && !reservation; i++) {
      try {
        reservation = await db().createReservation({
          code: await uniqueCode(),
          product_id: product.id,
          store_id: product.store_id,
          type,
          nickname,
          status: 'aguardando',
          expires_at: expiresAt(),
        });
      } catch (err) {
        if (err.code !== 'duplicate' || i === 2) throw err;
      }
    }
    await event('reserva_criada', traceId, { store_id: product.store_id, product_id: product.id, type });
    return { reservation: await viewOf(reservation) };
  },

  GET: async ({ query }) => {
    const code = String(query.code ?? '').trim().toUpperCase();
    if (!code) throw new HttpError(400, 'Informe o código da reserva.');
    const reservation = await db().getReservationByCode(code);
    if (!reservation) throw new HttpError(404, 'Reserva não encontrada. Confira o código.');
    return { reservation: await viewOf(reservation) };
  },
});
