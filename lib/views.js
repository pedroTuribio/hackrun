// Formatos de saída da API (ProductView, ReservationView), sem campos sensíveis.

export const storeSummary = (s) => (s ? { id: s.id, name: s.name, segment: s.segment, floor: s.floor, unit: s.unit } : null);

export function productView(product, store) {
  return { ...product, store: storeSummary(store) };
}

export function reservationView(reservation, product, store) {
  return { ...reservation, product: product ? productView(product, store) : null };
}

/** Mapa id -> loja (sem code) para montar várias views de uma vez. */
export async function storeMap(dbi) {
  const stores = await dbi.listStores();
  return new Map(stores.map((s) => [s.id, s]));
}
