// Autenticação simples por código (lojista e administração do shopping).
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './http.js';

const header = (headers, name) => String(headers?.[name] ?? '').trim();

/** Loja dona do header x-store-code (com code). 401 se inválido. */
export async function requireStore(headers) {
  const code = header(headers, 'x-store-code');
  if (!code) throw new HttpError(401, 'Informe o código da loja.');
  const store = await db().getStoreByCode(code);
  if (!store) throw new HttpError(401, 'Código da loja inválido.');
  return store;
}

export function requireAdmin(headers) {
  const given = Buffer.from(header(headers, 'x-admin-code').toUpperCase());
  const expected = Buffer.from(config().adminCode.toUpperCase());
  if (!given.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new HttpError(401, 'Código de administração inválido.');
  }
}

export const publicStore = ({ code, ...rest }) => rest;
