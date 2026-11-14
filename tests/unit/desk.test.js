// Laterais no computador: o QR leva à página inicial do cliente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appUrl, shortUrl, mountDesk } from '../../public/js/desk.js';
import { encodeQR } from '../../public/js/qr.js';

test('QR aponta para a página inicial do mesmo site', () => {
  assert.equal(appUrl({ origin: 'https://ponte-orcin.vercel.app' }), 'https://ponte-orcin.vercel.app/');
  assert.equal(appUrl({ origin: 'http://localhost:3000' }), 'http://localhost:3000/');
});

test('sem origem válida (arquivo local) usa o endereço publicado', () => {
  assert.equal(appUrl({ origin: 'null' }), 'https://ponte-orcin.vercel.app/');
  assert.equal(appUrl(undefined), 'https://ponte-orcin.vercel.app/');
});

test('endereço curto sem protocolo nem barra final', () => {
  assert.equal(shortUrl('https://ponte-orcin.vercel.app/'), 'ponte-orcin.vercel.app');
});

test('QR do endereço é gerado (cabe no QR, versão válida)', () => {
  const qr = encodeQR(appUrl({ origin: 'https://ponte-orcin.vercel.app' }));
  assert.ok(qr.version >= 1 && qr.version <= 10);
  assert.equal(qr.modules.length, qr.size);
});

test('mountDesk preenche o QR e o endereço', () => {
  const els = { 'desk-qr': { innerHTML: '', hidden: false }, 'desk-url': { textContent: '' } };
  const doc = { getElementById: (id) => els[id] || null };
  mountDesk(doc, { origin: 'https://ponte-orcin.vercel.app' });
  assert.match(els['desk-qr'].innerHTML, /^<svg[^>]+aria-label="QR Code para abrir a Ponte no celular"/);
  assert.equal(els['desk-url'].textContent, 'ponte-orcin.vercel.app');
});

test('index.html tem as laterais e carrega desk.js; CSS as esconde fora do computador', async () => {
  const html = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="desk-qr"/);
  assert.match(html, /src="\/js\/desk\.js"/);
  const css = await readFile(new URL('../../public/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.desk-side \{\s*display: none;/);
  assert.match(css, /@media \(min-width: 1180px\)/);
});
