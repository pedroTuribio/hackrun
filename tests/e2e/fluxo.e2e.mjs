// Teste ponta a ponta do fluxo da demo, num navegador de verdade (Chromium via Playwright).
// Sobe o servidor local (scripts/dev.js) numa porta livre, em memória e sem IA (modo regras).
// Uso: npm run test:e2e   (requer Playwright + Chromium: npx playwright install chromium)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = path.join(root, 'test-results', 'e2e');
const catalog = JSON.parse(readFileSync(path.join(root, 'data', 'catalog.json'), 'utf8'));
const storeCode = (storeId) => catalog.stores.find((s) => s.id === storeId).code;

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return await import('/opt/node-tools/node_modules/playwright/index.mjs');
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitHealth(base, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Servidor local não respondeu /api/health a tempo');
}

const mobile = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'pt-BR',
  timezoneId: 'America/Araguaina',
};

let server, browser, BASE;
const pageErrors = [];
const s = {}; // estado compartilhado entre os passos (o fluxo é sequencial)

function watch(page, name) {
  page.on('pageerror', (e) => pageErrors.push(`[${name}] ${e.message}`));
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

describe('Fluxo da demo no navegador (cliente → lojista → painel)', { timeout: 120000 }, () => {
  before(async () => {
    mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await loadPlaywright();
    const port = await freePort();
    BASE = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [path.join(root, 'scripts', 'dev.js')], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DATA_MODE: 'memory', PONTE_QUIET: '1', GEMINI_API_KEY: '' },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    await waitHealth(BASE);
    browser = await chromium.launch();
    // Linha de base do painel, para provar que a retirada da demo foi contada.
    const dash = await (await fetch(BASE + '/api/dashboard', { headers: { 'x-admin-code': 'SHOP2026' } })).json();
    s.pickedUpBefore = dash.totals.pickedUp;
  });

  after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) server.kill();
  });

  test('1. cliente busca "fone com cancelamento de ruído por R$ 599" e vê comparativo e resultados com selo e motivo', async () => {
    const ctx = await browser.newContext(mobile);
    s.cliente = watch(await ctx.newPage(), 'cliente');
    const c = s.cliente;
    await c.goto(BASE + '/');
    await c.waitForSelector('.hero');
    await c.fill('#q', 'fone com cancelamento de ruído por R$ 599');
    await c.press('#q', 'Enter');
    await c.waitForSelector('.result', { timeout: 15000 });

    assert.equal(await c.locator('.compare').count(), 1, 'comparativo online × shopping aparece');
    assert.match(await c.textContent('.compare-verdict'), /\S/, 'comparativo tem veredito');
    const cards = c.locator('.result');
    const n = await cards.count();
    assert.ok(n >= 1, 'pelo menos 1 resultado');
    for (let i = 0; i < n; i++) {
      const tag = (await cards.nth(i).locator('.tag').textContent()).trim();
      assert.match(tag, /^(Igual|Parecido)$/, `selo do resultado ${i + 1}`);
      const reason = (await cards.nth(i).locator('.reason').textContent()).trim();
      assert.ok(reason.length > 5, `motivo do resultado ${i + 1}`);
    }
    await shot(c, '01-resultados');
  });

  test('2. abre o produto, reserva "Separa pra mim" com apelido e vê código PT-####, QR e "Aguardando"', async () => {
    const c = s.cliente;
    const href = await c.getAttribute('.result .result-cta', 'href');
    s.productId = decodeURIComponent(href.split('/').pop());
    s.product = catalog.products.find((p) => p.id === s.productId);
    assert.ok(s.product, 'produto do resultado existe no catálogo');

    await c.click('.result .result-cta');
    await c.waitForSelector('.product-title');
    assert.equal((await c.textContent('.product-title')).trim(), s.product.name);

    await c.click('[data-reserve="separar"]');
    await c.waitForSelector('#reserve-sheet[open]');
    await c.fill('#nickname', 'Ana');
    const [resp] = await Promise.all([
      c.waitForResponse((r) => r.url().includes('/api/reservations') && r.request().method() === 'POST'),
      c.click('#reserve-submit'),
    ]);
    assert.ok(resp.ok(), `reserva criada (HTTP ${resp.status()})`);
    s.traceId = resp.headers()['x-trace-id'];
    assert.match(s.traceId || '', /^[A-Z0-9]{4,12}$/, 'resposta traz x-trace-id');

    await c.waitForSelector('.res-code');
    s.code = (await c.textContent('.res-code')).trim();
    assert.match(s.code, /^PT-\d{4}$/);
    assert.equal(await c.locator('.qr-box svg').count(), 1, 'QR Code em SVG');
    assert.match(await c.textContent('.pill[role="status"]'), /Aguardando/);
    await shot(c, '02-reserva-aguardando');
  });

  test('3. lojista entra com o código da loja e confirma a reserva pendente', async () => {
    const ctx = await browser.newContext(mobile);
    s.loja = watch(await ctx.newPage(), 'loja');
    const l = s.loja;
    await l.goto(BASE + '/loja.html');
    await l.fill('#store-code', storeCode(s.product.store_id));
    await l.click('#login-btn');
    const card = l.locator(`.res-card[aria-label="Reserva ${s.code}"]`);
    await card.waitFor({ timeout: 10000 });
    assert.match(await card.textContent(), /Ana/, 'apelido aparece para a loja');
    await shot(l, '03-loja-pendente');

    const [resp] = await Promise.all([
      l.waitForResponse((r) => r.url().includes('/api/store-reservations') && r.request().method() !== 'GET'),
      card.locator('[data-act="confirmar"]').click(),
    ]);
    assert.equal(resp.status(), 200, 'confirmação aceita pela API');
  });

  test('4. cliente vê o status mudar para confirmada (polling)', async () => {
    const c = s.cliente;
    await c.waitForSelector('.pill-confirmada', { timeout: 15000 });
    assert.match(await c.textContent('.pill[role="status"]'), /Confirmada/);
    await shot(c, '04-reserva-confirmada');
  });

  test('5. lojista faz check-in digitando o código e a reserva fica retirada', async () => {
    const l = s.loja;
    await l.fill('#checkin-code', s.code.replace('PT-', ''));
    await l.click('#checkin-btn');
    await l.waitForSelector('.checkin-result.ok', { timeout: 10000 });
    assert.match(await l.textContent('.checkin-result.ok'), new RegExp(s.code));
    await shot(l, '05-loja-checkin');

    const api = await (await fetch(`${BASE}/api/reservations?code=${s.code}`)).json();
    assert.equal(api.reservation.status, 'retirada');
    const c = s.cliente;
    await c.reload();
    await c.waitForSelector('.pill-retirada', { timeout: 10000 });
    assert.match(await c.textContent('.pill[role="status"]'), /Retirada/);
  });

  test('6. painel com SHOP2026 mostra KPIs, retiradas ≥ 1 e logs filtráveis pelo traceId', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR', timezoneId: 'America/Araguaina' });
    const p = watch(await ctx.newPage(), 'painel');
    await p.goto(BASE + '/painel.html');
    await p.fill('#admin-code', 'SHOP2026');
    await p.click('#login-btn');
    await p.waitForSelector('.kpi');
    assert.equal(await p.locator('.kpi').count(), 6, '6 indicadores');
    const kpi = (label) =>
      p.locator('.kpi').filter({ has: p.locator('.l', { hasText: new RegExp(`^${label}$`) }) }).locator('.n').textContent();
    const retiradas = Number((await kpi('Retiradas')).replace(/\D/g, ''));
    assert.ok(retiradas >= 1, 'retiradas ≥ 1');
    assert.ok(retiradas >= s.pickedUpBefore + 1, 'a retirada da demo foi contada');
    assert.ok(Number((await kpi('Buscas')).replace(/\D/g, '')) >= 1, 'buscas ≥ 1');
    await shot(p, '06-painel');

    await p.click('[data-tab="logs"]');
    await p.waitForSelector('table.logs tbody tr');
    assert.ok((await p.locator('table.logs tbody tr').count()) >= 1, 'aba Logs lista eventos');

    await p.fill('#log-trace', s.traceId);
    await Promise.all([
      p.waitForResponse((r) => r.url().includes('/api/logs') && r.url().includes(`trace=${s.traceId}`)),
      p.click('#logs-btn'),
    ]);
    await p.waitForSelector('table.logs tbody tr');
    const rows = p.locator('table.logs tbody tr');
    const n = await rows.count();
    assert.ok(n >= 1, 'há evento com o traceId da reserva');
    for (let i = 0; i < n; i++) assert.equal((await rows.nth(i).locator('.trace-btn').textContent()).trim(), s.traceId);
    assert.match(await rows.first().textContent(), /Reserva/i, 'o evento é a reserva criada');
    await shot(p, '07-painel-logs-trace');
  });

  test('7. busca sem resultado ("patinete elétrico") mostra o estado de não encontrado', async () => {
    const c = s.cliente;
    await c.goto(BASE + '/#/');
    await c.waitForSelector('#q');
    await c.fill('#q', 'patinete elétrico');
    await c.press('#q', 'Enter');
    await c.waitForSelector('.empty', { timeout: 15000 });
    assert.match(await c.textContent('.empty h2'), /Ainda não temos isso/);
    assert.equal(await c.locator('.result').count(), 0);
    await shot(c, '08-nao-encontrado');
  });

  test('8. nenhum erro de JavaScript (pageerror) em todas as páginas', () => {
    assert.deepEqual(pageErrors, []);
  });
});
