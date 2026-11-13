import './_helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, tokenize, stem, expand, parseNumber, parsePrices, brl } from '../../lib/text.js';

describe('text.js — normalização', () => {
  test('remove acentos, põe em minúsculas e colapsa espaços', () => {
    assert.equal(normalize('  Fone  com Cancelamento de RUÍDO  '), 'fone com cancelamento de ruido');
    assert.equal(normalize('Tênis Ação Coração'), 'tenis acao coracao');
  });

  test('aceita null/undefined/número sem quebrar', () => {
    assert.equal(normalize(null), '');
    assert.equal(normalize(undefined), '');
    assert.equal(normalize(123), '123');
  });
});

describe('text.js — tokens', () => {
  test('remove stopwords e palavras de uma letra', () => {
    assert.deepEqual(tokenize('Quero um fone com cancelamento de ruído'), ['fone', 'cancelamento', 'ruido']);
  });

  test('"sem fio" e "wireless" viram o mesmo token; "com fio" é outro', () => {
    assert.deepEqual(tokenize('fone sem fio'), ['fone', 'semfio']);
    assert.deepEqual(tokenize('fone wireless'), ['fone', 'semfio']);
    assert.deepEqual(tokenize('fone com fios'), ['fone', 'comfio']);
  });

  test('plural simples é reduzido igual na busca e no catálogo', () => {
    assert.equal(stem('fones'), 'fone');
    assert.equal(stem('monitores'), 'monitor');
    assert.equal(stem('botoes'), 'botao');
    assert.equal(stem('gas'), 'gas', 'palavras curtas ficam como estão');
    assert.equal(stem('cross'), 'cross', 'terminação "ss" fica como está');
  });

  test('mantém números (modelo do produto)', () => {
    assert.deepEqual(tokenize('Pulse 700'), ['pulse', '700']);
  });

  test('sinônimos expandem para a forma canônica', () => {
    assert.deepEqual(expand('headphone'), ['headphone', 'fone']);
    assert.deepEqual(expand('laptop'), ['laptop', 'notebook']);
    assert.deepEqual(expand('fone'), ['fone']);
  });
});

describe('text.js — números e preços', () => {
  test('parseNumber entende formato brasileiro e ponto decimal', () => {
    assert.equal(parseNumber('1.599,90'), 1599.9);
    assert.equal(parseNumber('489,90'), 489.9);
    assert.equal(parseNumber('500'), 500);
    assert.equal(parseNumber('499.9'), 499.9);
    assert.equal(parseNumber('1.299'), 1299);
    assert.equal(parseNumber('1.299,00'), 1299);
    assert.equal(parseNumber(''), null);
    assert.equal(parseNumber('abc'), null);
  });

  test('"até 500" vira preço máximo', () => {
    const r = parsePrices('tênis de corrida até 500');
    assert.equal(r.maxPrice, 500);
    assert.equal(r.onlinePrice, null);
    assert.equal(r.rest, 'tenis de corrida');
  });

  test('"até R$ 500,00", "abaixo de 300", "no máximo 250", "até 4 mil"', () => {
    assert.equal(parsePrices('fone até R$ 500,00').maxPrice, 500);
    assert.equal(parsePrices('mochila abaixo de 300').maxPrice, 300);
    assert.equal(parsePrices('perfume no máximo 250').maxPrice, 250);
    assert.equal(parsePrices('notebook até 4 mil').maxPrice, 4000);
  });

  test('"R$ 489,90" vira preço visto online', () => {
    const r = parsePrices('fone Pulse 700 R$ 489,90');
    assert.equal(r.onlinePrice, 489.9);
    assert.equal(r.maxPrice, null);
    assert.equal(r.rest, 'fone pulse 700');
  });

  test('"1.299,00" com milhar e centavos', () => {
    assert.equal(parsePrices('notebook R$ 1.299,00').onlinePrice, 1299);
    assert.equal(parsePrices('notebook até 1.299,00').maxPrice, 1299);
    assert.equal(parsePrices('notebook por 1.299,00 reais').onlinePrice, 1299);
  });

  test('máximo e preço online na mesma frase', () => {
    const r = parsePrices('vi por R$ 520,00, quero até 480');
    assert.equal(r.maxPrice, 480);
    assert.equal(r.onlinePrice, 520);
  });

  test('número de modelo sozinho não é preço', () => {
    const r = parsePrices('fone pulse 700');
    assert.equal(r.maxPrice, null);
    assert.equal(r.onlinePrice, null);
  });

  test('brl formata em reais', () => {
    assert.equal(brl(489.9), 'R$ 489,90');
    assert.equal(brl(1299), 'R$ 1.299,00');
  });
});
