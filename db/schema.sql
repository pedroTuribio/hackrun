-- Ponte — esquema do banco (Supabase / PostgreSQL)
-- Rode no SQL Editor do Supabase antes de db/seed.sql.
-- RLS ligado em todas as tabelas e SEM políticas públicas: só a API (chave service_role) acessa.

create extension if not exists pgcrypto;

create table if not exists stores (
  id       text primary key,
  code     text not null unique,               -- código de acesso do lojista (nunca exposto em rotas públicas)
  name     text not null,
  segment  text not null,
  floor    smallint not null check (floor between 1 and 3),
  unit     text not null,
  hours    text not null default '10h–22h'
);

create table if not exists products (
  id          text primary key,
  store_id    text not null references stores(id) on delete cascade,
  name        text not null,
  category    text not null,
  segment     text not null,
  brand       text not null default '',
  color       text not null default '',
  price       numeric(10,2) not null check (price >= 0),
  stock       integer not null default 0 check (stock >= 0),
  tags        text[] not null default '{}',
  description text not null default ''
);

create table if not exists reservations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  product_id  text not null references products(id),
  store_id    text not null references stores(id),
  type        text not null check (type in ('separar', 'testar')),
  nickname    text not null check (char_length(nickname) between 1 and 30),
  status      text not null default 'aguardando'
              check (status in ('aguardando', 'confirmada', 'recusada', 'retirada')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz
);

create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in (
                'busca_realizada', 'busca_sem_resultado', 'reserva_criada', 'reserva_confirmada',
                'reserva_recusada', 'retirada_confirmada', 'erro_ia', 'erro_api')),
  trace_id    text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists products_store_idx      on products (store_id);
create index if not exists products_category_idx   on products (category);
create index if not exists reservations_code_idx   on reservations (code);
create index if not exists reservations_store_idx  on reservations (store_id);
create index if not exists events_type_idx         on events (type);
create index if not exists events_created_at_idx   on events (created_at desc);
create index if not exists events_trace_idx        on events (trace_id);

alter table stores       enable row level security;
alter table products     enable row level security;
alter table reservations enable row level security;
alter table events       enable row level security;
-- Sem "create policy": anon/authenticated não leem nem escrevem nada.
