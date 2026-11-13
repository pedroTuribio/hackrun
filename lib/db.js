// Ponto único de acesso aos dados: escolhe memória ou Supabase conforme config().dataMode.
import { config } from './config.js';
import { createMemoryDb } from './db-memory.js';
import { createSupabaseDb } from './db-supabase.js';

let instance = null;

export function db() {
  if (!instance) {
    const cfg = config();
    instance = cfg.dataMode === 'supabase'
      ? createSupabaseDb({ url: cfg.supabaseUrl, key: cfg.supabaseKey })
      : createMemoryDb();
  }
  return instance;
}

// Só para testes: descarta a instância atual (ex.: para recomeçar a memória).
export function resetDb() {
  instance = null;
}
