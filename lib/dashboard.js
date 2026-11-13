// Indicadores do painel do shopping, calculados a partir dos eventos de negócio.
const rate = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : 0);

function top(map, n = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([term, v]) => ({ term, category: v.category ?? null, count: v.count }));
}

export async function dashboard(dbi) {
  const [events, stores] = await Promise.all([dbi.listEvents({ limit: 5000 }), dbi.listStores()]);
  const count = (type) => events.filter((e) => e.type === type).length;

  const totals = {
    searches: count('busca_realizada'),
    searchesWithoutResult: count('busca_sem_resultado'),
    reservations: count('reserva_criada'),
    confirmed: count('reserva_confirmada'),
    refused: count('reserva_recusada'),
    pickedUp: count('retirada_confirmada'),
    aiErrors: count('erro_ia'),
    apiErrors: count('erro_api'),
  };
  const rates = {
    searchToReservation: rate(totals.reservations, totals.searches),
    reservationToPickup: rate(totals.pickedUp, totals.reservations),
    confirmation: rate(totals.confirmed, totals.confirmed + totals.refused),
    searchWithoutResult: rate(totals.searchesWithoutResult, totals.searches),
  };

  const unmet = new Map();
  const searches = new Map();
  for (const e of events) {
    if (e.type === 'busca_sem_resultado') {
      const term = String(e.data?.term ?? '').trim();
      if (!term) continue;
      const v = unmet.get(term) ?? { count: 0, category: e.data?.category };
      v.count++;
      unmet.set(term, v);
    } else if (e.type === 'busca_realizada') {
      const term = String(e.data?.term ?? e.data?.query ?? '').trim();
      if (!term) continue;
      const v = searches.get(term) ?? { count: 0, category: e.data?.category };
      v.count++;
      searches.set(term, v);
    }
  }

  const per = new Map(stores.map((s) => [s.id, { reservations: 0, confirmed: 0, refused: 0, pickedUp: 0 }]));
  const field = { reserva_criada: 'reservations', reserva_confirmada: 'confirmed', reserva_recusada: 'refused', retirada_confirmada: 'pickedUp' };
  for (const e of events) {
    const f = field[e.type];
    const s = f && per.get(e.data?.store_id);
    if (s) s[f]++;
  }
  const byStore = stores
    .map((s) => ({ store: { id: s.id, name: s.name, segment: s.segment, floor: s.floor, unit: s.unit }, ...per.get(s.id) }))
    .sort((a, b) => b.reservations - a.reservations || a.store.name.localeCompare(b.store.name));

  return {
    totals,
    rates,
    unmetDemand: top(unmet),
    topSearches: top(searches),
    byStore,
    period: { from: events.at(-1)?.created_at ?? null, to: events[0]?.created_at ?? null, events: events.length },
    updatedAt: new Date().toISOString(),
  };
}
