import { randomInt, randomUUID } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I para evitar confusão

export function traceId() {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function reservationCode() {
  return `PT-${randomInt(1000, 10000)}`;
}

export function uuid() {
  return randomUUID();
}
