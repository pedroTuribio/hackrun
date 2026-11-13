// Gera db/seed.sql a partir de data/catalog.json.  Uso: node scripts/gen-seed.js
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('data/catalog.json', root), 'utf8'));

const str = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
const num = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`número inválido: ${v}`);
  return String(n);
};
const arr = (list) => (list?.length ? `array[${list.map(str).join(', ')}]::text[]` : `'{}'::text[]`);

const lines = [
  '-- Gerado por scripts/gen-seed.js a partir de data/catalog.json. Não edite à mão.',
  '-- Pode rodar de novo: atualiza lojas e produtos existentes.',
  'begin;',
  '',
  'insert into stores (id, code, name, segment, floor, unit, hours) values',
  catalog.stores.map((s) =>
    `  (${[str(s.id), str(s.code), str(s.name), str(s.segment), num(s.floor), str(s.unit), str(s.hours)].join(', ')})`).join(',\n'),
  'on conflict (id) do update set code = excluded.code, name = excluded.name, segment = excluded.segment,',
  '  floor = excluded.floor, unit = excluded.unit, hours = excluded.hours;',
  '',
  'insert into products (id, store_id, name, category, segment, brand, color, price, stock, tags, description) values',
  catalog.products.map((p) =>
    `  (${[str(p.id), str(p.store_id), str(p.name), str(p.category), str(p.segment), str(p.brand), str(p.color),
      num(p.price), num(p.stock), arr(p.tags), str(p.description)].join(', ')})`).join(',\n'),
  'on conflict (id) do update set store_id = excluded.store_id, name = excluded.name, category = excluded.category,',
  '  segment = excluded.segment, brand = excluded.brand, color = excluded.color, price = excluded.price,',
  '  stock = excluded.stock, tags = excluded.tags, description = excluded.description;',
  '',
  'commit;',
  '',
];

const out = fileURLToPath(new URL('db/seed.sql', root));
writeFileSync(out, lines.join('\n'));
console.log(`seed.sql: ${catalog.stores.length} lojas, ${catalog.products.length} produtos -> ${out}`);
