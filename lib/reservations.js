// Regras de reserva: validade, código único e formato de saída.
import { db } from './db.js';
import { reservationCode } from './codes.js';
import { reservationView } from './views.js';

const OFFSET_H = -3; // America/Araguaina (Palmas–TO), sem horário de verão
const CLOSING_HOUR = 22;
const LATE_HOURS = 4;
const MIN_WINDOW_MS = 2 * 3600_000;

/**
 * Validade: até as 22h (horário de Palmas) de hoje. Se faltar menos de 2 h para as 22h
 * (ou já tiver passado), a reserva vale 4 h a partir de agora.
 */
export function expiresAt(now = new Date()) {
  const local = new Date(now.getTime() + OFFSET_H * 3600_000);
  const closing = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), CLOSING_HOUR - OFFSET_H, 0, 0);
  const t = closing - now.getTime() >= MIN_WINDOW_MS ? closing : now.getTime() + LATE_HOURS * 3600_000;
  return new Date(t).toISOString();
}

export async function uniqueCode(tries = 25) {
  for (let i = 0; i < tries; i++) {
    const code = reservationCode();
    if (!(await db().getReservationByCode(code))) return code;
  }
  throw new Error('não foi possível gerar código de reserva único');
}

/** Reserva + produto (com loja), pronto para a API. */
export async function viewOf(reservation, cache = {}) {
  const product = cache.products?.get(reservation.product_id) ?? (await db().getProduct(reservation.product_id));
  let stores = cache.stores;
  if (!stores) stores = new Map((await db().listStores()).map((s) => [s.id, s]));
  return reservationView(reservation, product, product ? stores.get(product.store_id) : null);
}

export async function viewsOf(list) {
  const [products, stores] = await Promise.all([db().listProducts(), db().listStores()]);
  const cache = { products: new Map(products.map((p) => [p.id, p])), stores: new Map(stores.map((s) => [s.id, s])) };
  return Promise.all(list.map((r) => viewOf(r, cache)));
}
