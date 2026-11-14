// Arquivo separado: o "modelo reserva" é um estado do módulo lib/ai.js (vale para a instância inteira).
import { geminiResponse, stubFetch } from './_helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as ai from '../../lib/ai.js';

describe('ai.js — modelo inexistente', () => {
  test('404 no modelo configurado: tenta de novo com gemini-2.5-flash e passa a usá-lo', async () => {
    process.env.GEMINI_API_KEY = 'chave-falsa-de-teste';
    process.env.GEMINI_MODEL = 'modelo-que-nao-existe';
    const stub = stubFetch((url) => (url.includes('modelo-que-nao-existe')
      ? new Response('{"error":{"code":404}}', { status: 404 })
      : geminiResponse({ name: 'fone', category: 'Fones de ouvido', keywords: ['fone'], confidence: 'alta' })));
    try {
      const out = await ai.interpret({ query: 'fone' });
      assert.equal(out.name, 'fone');
      assert.equal(stub.calls.length, 2);
      assert.match(stub.calls[0].url, /models\/modelo-que-nao-existe:generateContent$/);
      assert.match(stub.calls[1].url, /models\/gemini-2\.5-flash:generateContent$/);

      await ai.interpret({ query: 'fone' });
      assert.equal(stub.calls.length, 3, 'na segunda vez vai direto no modelo reserva');
      assert.match(stub.calls[2].url, /gemini-2\.5-flash/);
    } finally {
      stub.restore();
      delete process.env.GEMINI_MODEL;
    }
  });

  test('sem GEMINI_API_KEY a IA nem é chamada', async () => {
    delete process.env.GEMINI_API_KEY;
    const stub = stubFetch(() => { throw new Error('não deveria chamar'); });
    try {
      await assert.rejects(ai.interpret({ query: 'fone' }), /sem GEMINI_API_KEY/);
      assert.equal(stub.calls.length, 0);
    } finally {
      stub.restore();
    }
  });
});

describe('ai.js — modelo sobrecarregado (503)', () => {
  test('503 "high demand" no modelo principal: usa o próximo modelo e a busca segue com IA', async () => {
    process.env.GEMINI_API_KEY = 'chave-falsa-de-teste';
    process.env.GEMINI_MODEL = 'modelo-lotado';
    ai._resetModelState();
    const stub = stubFetch((url) => (url.includes('modelo-lotado')
      ? new Response('{"error":{"code":503,"status":"UNAVAILABLE","message":"This model is currently experiencing high demand."}}', { status: 503 })
      : geminiResponse({ name: 'fone', category: 'Fones de ouvido', keywords: ['fone'], confidence: 'alta' })));
    try {
      const out = await ai.interpret({ query: 'fone' });
      assert.equal(out.name, 'fone');
      assert.ok(stub.calls.length >= 2);
      assert.match(stub.calls[0].url, /modelo-lotado/);
      assert.doesNotMatch(stub.calls.at(-1).url, /modelo-lotado/);
    } finally {
      stub.restore();
      delete process.env.GEMINI_MODEL;
    }
  });

  test('chave inválida (400 sem "model") não troca de modelo: falha logo', async () => {
    process.env.GEMINI_API_KEY = 'chave-falsa-de-teste';
    process.env.GEMINI_MODEL = 'outro-modelo';
    ai._resetModelState();
    const stub = stubFetch(() => new Response('{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"API key not valid."}}', { status: 400 }));
    try {
      await assert.rejects(ai.interpret({ query: 'fone' }), /API key not valid/);
      assert.equal(stub.calls.length, 1);
    } finally {
      stub.restore();
      delete process.env.GEMINI_MODEL;
    }
  });
});
