// App do cliente: busca → resultados → produto → reserva → roteiro (rotas por hash).
import { api } from './api.js';
import { qrSVG } from './qr.js';
import { compressImage } from './image.js';
import {
  icon, esc, brl, floorLabel, fmtTime, relTime, stockLabel, segMedia, segmentInfo,
  CHIP_SEGMENTS, local, session, toast, clearToasts, showError, withBusy, $, $$,
} from './ui.js';

const root = $('#app');
let viewToken = 0;
let cleanup = [];
const productCache = new Map();
let inflight = null; // busca em andamento: { promise, query, thumb, isImage }
let lastRequest = null; // para "Tentar de novo"

// ---------- Estado local (localStorage) ----------
const getReservas = () => {
  const v = local.get('reservas', []);
  return Array.isArray(v) ? v : [];
};
const setReservas = (v) => {
  local.set('reservas', v.slice(0, 30));
  updateBadges();
};
const getRoteiro = () => {
  const v = local.get('roteiro', []);
  return Array.isArray(v) ? v.filter((x) => x && x.id) : [];
};
const setRoteiro = (v) => {
  local.set('roteiro', v.slice(0, 40));
  updateBadges();
};
const inRoteiro = (id) => getRoteiro().some((x) => String(x.id) === String(id));

function addToRoteiro(p) {
  if (!p || !p.id || inRoteiro(p.id)) return false;
  const st = p.store || {};
  setRoteiro([
    ...getRoteiro(),
    { id: p.id, name: p.name, price: p.price, segment: p.segment || st.segment, storeName: st.name, floor: st.floor, unit: st.unit },
  ]);
  return true;
}

function upsertReserva(r) {
  if (!r || !r.code) return;
  const p = r.product || {};
  const st = p.store || {};
  const list = getReservas().filter((x) => x.code !== r.code);
  const prev = getReservas().find((x) => x.code === r.code) || {};
  list.unshift({
    ...prev,
    code: r.code,
    productId: r.product_id || p.id || prev.productId,
    productName: p.name || prev.productName,
    storeName: st.name || prev.storeName,
    segment: p.segment || st.segment || prev.segment,
    floor: st.floor ?? prev.floor,
    type: r.type || prev.type,
    status: r.status || prev.status,
    createdAt: r.created_at || prev.createdAt || new Date().toISOString(),
    expiresAt: r.expires_at || prev.expiresAt,
  });
  list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  setReservas(list);
}

function updateBadges() {
  const counts = { reservas: getReservas().length, roteiro: getRoteiro().length };
  for (const [k, n] of Object.entries(counts)) {
    const b = document.querySelector(`[data-badge="${k}"]`);
    if (!b) continue;
    b.hidden = !n;
    b.textContent = n > 9 ? '9+' : String(n);
    b.setAttribute('aria-label', `${n} ${k === 'reservas' ? 'reservas' : 'itens no roteiro'}`);
  }
}

function cacheProducts(list) {
  for (const p of list || []) if (p && p.id) productCache.set(String(p.id), p);
}

// ---------- Roteador ----------
const routes = [
  [/^#?\/?$/, viewHome, 'home'],
  [/^#\/resultados\/?$/, viewResults, 'home'],
  [/^#\/produto\/([^/]+)$/, viewProduct, 'home'],
  [/^#\/reserva\/([^/]+)$/, viewReservation, 'reservas'],
  [/^#\/reservas\/?$/, viewReservations, 'reservas'],
  [/^#\/roteiro\/?$/, viewRoute, 'roteiro'],
];

function router() {
  cleanup.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignora */
    }
  });
  cleanup = [];
  viewToken++;
  clearToasts();
  const hash = location.hash || '#/';
  for (const [re, fn, nav] of routes) {
    const m = hash.match(re);
    if (m) {
      $$('.bottom-nav a').forEach((a) => {
        if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      window.scrollTo(0, 0);
      try {
        fn(...m.slice(1).map((s) => decodeURIComponent(s)));
      } catch (err) {
        console.error(err);
        renderFatal();
      }
      return;
    }
  }
  location.replace('#/');
}

function render(html) {
  root.innerHTML = `<div class="view">${html}</div>`;
}

function topbar(title, back = true) {
  return `<header class="topbar">
    ${back ? `<button type="button" class="icon-btn" data-back aria-label="Voltar">${icon('back')}</button>` : '<span style="width:8px"></span>'}
    <h1>${esc(title)}</h1>
  </header>`;
}

// "Voltar" confiável: se a navegação começou no app, volta; senão vai para a rota indicada.
let navCount = 0;
window.addEventListener('hashchange', () => navCount++);
function goBack(fallback) {
  if (navCount > 0) history.back();
  else location.hash = fallback;
}

function renderFatal() {
  render(`${topbar('Ponte')}
    <div class="page"><div class="card empty">
      <div class="empty-ico">${icon('alert')}</div>
      <h2>Ops, algo saiu do lugar</h2>
      <p>Volte para a busca e tente de novo.</p>
      <a class="btn btn-primary" href="#/">Ir para a busca</a>
    </div></div>`);
  wireBackTo('#/');
}

function wireBackTo(fallback) {
  $$('[data-back]', root).forEach((b) => b.addEventListener('click', () => goBack(fallback)));
}

// ---------- 1. Busca ----------
function viewHome() {
  const nRes = getReservas().length;
  const nRot = getRoteiro().length;
  render(`
    <section class="hero">
      <div class="brand">
        <div class="brand-mark">${icon('bridge')}</div>
        <span class="brand-name">Ponte</span>
      </div>
      <h1 class="hero-title">Viu online? <em>Resolve hoje</em> no shopping.</h1>
      <p class="hero-sub">Mande o print ou diga o que procura. A gente mostra qual loja tem agora — e separa pra você.</p>
    </section>

    <form class="search-card" id="search-form" role="search" autocomplete="off">
      <label class="sr-only" for="q">O que você procura?</label>
      <div class="search-field">
        ${icon('search')}
        <input id="q" name="q" type="search" enterkeyhint="search" maxlength="200" placeholder="Ex.: fone com cancelamento de ruído">
        <button class="search-go" type="submit" aria-label="Buscar">${icon('chevron')}</button>
      </div>
      <div class="or-line" aria-hidden="true">ou</div>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="photo-btn">
        ${icon('camera')}<span>Enviar foto ou print</span>
      </button>
    </form>

    <div class="page">
      <section aria-labelledby="seg-title">
        <h2 class="section-title" id="seg-title" style="margin-bottom:10px">Explore por segmento</h2>
        <div class="chips">
          ${CHIP_SEGMENTS.map(
            (s) => `<button type="button" class="chip" data-seg="${esc(s.label)}" data-q="${esc(s.q || s.label)}">
              <span class="chip-ico" style="background:linear-gradient(145deg,${s.c[0]},${s.c[1]})">${icon(s.icon)}</span>${esc(s.label)}
            </button>`,
          ).join('')}
        </div>
      </section>

      <div class="quick-grid">
        <a class="quick" href="#/reservas">
          <span class="quick-ico">${icon('ticket')}</span>
          <span><span class="quick-num">${nRes}</span></span>
          <span class="quick-label">Minhas reservas</span>
        </a>
        <a class="quick" href="#/roteiro">
          <span class="quick-ico">${icon('route')}</span>
          <span><span class="quick-num">${nRot}</span></span>
          <span class="quick-label">Minha lista / roteiro</span>
        </a>
      </div>

      <section class="card how" aria-labelledby="how-title">
        <h2 class="section-title" id="how-title">Como funciona</h2>
        <div class="how-step"><span class="how-num">1</span><div><strong>Mostre o que viu</strong><span>Print do anúncio, foto ou uma frase.</span></div></div>
        <div class="how-step"><span class="how-num">2</span><div><strong>Veja quem tem no shopping</strong><span>Loja, piso, preço e estoque — e quanto custa online.</span></div></div>
        <div class="how-step"><span class="how-num">3</span><div><strong>Separe e retire hoje</strong><span>A loja confirma e você mostra o QR no balcão.</span></div></div>
      </section>

      <p class="foot-note">${icon('lock', 'icon-sm')}Sem cadastro. Fotos apagadas após a busca.</p>
    </div>
  `);

  const form = $('#search-form', root);
  const input = $('#q', root);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) {
      input.focus();
      toast('Digite o que você procura ou envie uma foto do produto.');
      return;
    }
    startSearch({ query });
  });
  $('#photo-btn', root).addEventListener('click', () => {
    const fi = $('#photo-input');
    fi.value = '';
    fi.click();
  });
  $$('[data-seg]', root).forEach((b) => b.addEventListener('click', () => startSearch({ query: b.dataset.q, display: b.dataset.seg })));
}

$('#photo-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const typed = ($('#q') && $('#q').value.trim()) || '';
  try {
    const img = await compressImage(file);
    startSearch({ query: typed, image: { mimeType: img.mimeType, data: img.data }, thumb: img.thumb });
  } catch (err) {
    toast(err.message || 'Não consegui ler essa imagem.', { type: 'error' });
  }
});

function startSearch(req) {
  lastRequest = req;
  const body = {};
  if (req.query) body.query = req.query;
  if (req.image) body.image = req.image;
  const promise = api('/api/search', { method: 'POST', body, timeout: 25000 });
  inflight = { promise, query: req.query || '', display: req.display || null, thumb: req.thumb || null, isImage: !!req.image };
  promise
    .then((res) => {
      cacheProducts((res.results || []).map((r) => r.product));
      session.set('lastSearch', { query: req.query || '', display: req.display || null, thumb: req.thumb || null, isImage: !!req.image, res, at: Date.now() });
    })
    .catch(() => {})
    .finally(() => {
      if (inflight && inflight.promise === promise) inflight = null;
    });
  if (location.hash === '#/resultados') router();
  else location.hash = '#/resultados';
}

// ---------- 2. Resultados ----------
function viewResults() {
  const token = viewToken;
  if (inflight) {
    const { promise, query, display, thumb, isImage } = inflight;
    renderLoading({ query, display, thumb, isImage });
    promise.then(
      (res) => {
        if (token === viewToken) renderResults({ query, display, thumb, isImage, res });
      },
      (err) => {
        if (token !== viewToken) return;
        const needsText = err.status === 400 && lastRequest && lastRequest.image;
        if (!needsText) showError(err, 'Não deu para buscar agora');
        renderSearchError(err, { query, display, thumb, isImage });
      },
    );
    return;
  }
  const last = session.get('lastSearch');
  if (last && last.res) {
    cacheProducts((last.res.results || []).map((r) => r.product));
    renderResults(last);
  } else {
    location.replace('#/');
  }
}

function queryHead({ query, display, thumb, isImage }, res) {
  const interp = (res && res.interpreted) || {};
  const name = display || interp.name || query || (isImage ? 'Produto da sua foto' : 'Sua busca');
  const thumbHtml = thumb
    ? `<img class="query-thumb" src="${esc(thumb)}" alt="Prévia da imagem enviada">`
    : `<div class="query-thumb query-thumb-txt" aria-hidden="true">${icon(isImage ? 'image' : 'search')}</div>`;
  let source = '';
  if (res) {
    if (res.source === 'ia') {
      const c = ['alta', 'media', 'baixa'].includes(res.confidence) ? res.confidence : 'media';
      const label = { alta: 'alta', media: 'média', baixa: 'baixa' }[c];
      source = `<span class="source-line">${icon('sparkle', 'icon-sm')}Identificado pela IA · <span class="conf conf-${c}">confiança ${label}</span></span>`;
    } else {
      source = `<span class="source-line">${icon('list', 'icon-sm')}Interpretado por regras</span>`;
    }
  }
  return `<div class="query-head">
    ${thumbHtml}
    <div class="query-text">
      <div class="query-label">${isImage ? 'Você enviou' : display ? 'Segmento' : 'Você buscou'}</div>
      <div class="query-name">${esc(name)}</div>
      ${source}
    </div>
  </div>`;
}

const LOAD_MSGS_IMG = ['Lendo seu print…', 'Identificando o produto…', 'Procurando nas lojas…', 'Comparando preços…'];
const LOAD_MSGS_TXT = ['Entendendo sua busca…', 'Procurando nas lojas…', 'Conferindo estoque…', 'Comparando preços…'];

function renderLoading(ctx) {
  const msgs = ctx.isImage ? LOAD_MSGS_IMG : LOAD_MSGS_TXT;
  const skel = `<div class="skel-card" aria-hidden="true">
      <div class="skel" style="width:76px;height:76px;border-radius:12px"></div>
      <div class="skel-lines">
        <div class="skel" style="height:12px;width:45%"></div>
        <div class="skel" style="height:16px;width:85%"></div>
        <div class="skel" style="height:14px;width:35%"></div>
      </div>
    </div>`;
  render(`${topbar('Resultados')}
    <div class="page" aria-busy="true">
      ${queryHead(ctx, null)}
      <div class="loading-msg" role="status"><span class="spinner" aria-hidden="true"></span><span id="load-msg">${msgs[0]}</span></div>
      <div class="skel" style="height:150px;border-radius:22px" aria-hidden="true"></div>
      ${skel}${skel}${skel}
    </div>`);
  wireBackTo('#/');
  let i = 0;
  const t = setInterval(() => {
    const el = $('#load-msg');
    if (!el) return;
    i = (i + 1) % msgs.length;
    el.style.opacity = '0';
    setTimeout(() => {
      el.textContent = msgs[i];
      el.style.opacity = '1';
    }, 200);
  }, 1900);
  cleanup.push(() => clearInterval(t));
}

function renderSearchError(err, ctx = {}) {
  if (err.status === 400 && lastRequest && lastRequest.image) {
    render(`${topbar('Resultados')}
      <div class="page">
        ${queryHead(ctx, null)}
        <form class="card" id="describe-form" style="display:grid;gap:12px" novalidate>
          <div class="banner" role="note">${icon('alert')}<span>${esc(err.message || 'Não consegui ler a foto agora.')}</span></div>
          <div>
            <label class="field-label" for="describe">O que tem na foto?</label>
            <input class="input" id="describe" maxlength="200" enterkeyhint="search" placeholder="Ex.: headphone bluetooth preto" value="${esc(lastRequest.query || '')}">
            <p class="field-hint">Usamos sua foto e essa descrição juntas.</p>
          </div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">${icon('search')}Buscar com a descrição</button>
        </form>
      </div>`);
    wireBackTo('#/');
    const input = $('#describe', root);
    input.focus();
    $('#describe-form', root).addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return input.focus();
      startSearch({ ...lastRequest, query: q });
    });
    return;
  }
  render(`${topbar('Resultados')}
    <div class="page">
      <div class="card empty">
        <div class="empty-ico">${icon('refresh')}</div>
        <h2>Não deu para buscar agora</h2>
        <p>${esc(err && err.kind === 'timeout' ? 'A busca demorou mais que o normal.' : 'Tivemos um problema de conexão com as lojas.')}${err && err.traceId ? ` Código: <code class="code-chip">${esc(err.traceId)}</code>` : ''}</p>
        <div class="btn-row" style="width:100%">
          <a class="btn btn-outline" href="#/">Nova busca</a>
          <button class="btn btn-primary" type="button" id="retry">Tentar de novo</button>
        </div>
      </div>
    </div>`);
  wireBackTo('#/');
  $('#retry', root).addEventListener('click', () => lastRequest && startSearch(lastRequest));
}

function compareCard(c) {
  if (!c || c.onlinePrice == null || c.shoppingPrice == null) return '';
  const days = Number(c.deliveryDays);
  const daysTxt = Number.isFinite(days) ? `${days} ${days === 1 ? 'dia' : 'dias'}` : String(c.deliveryDays || 'alguns dias');
  const ship = Number(c.shippingEstimate);
  const shipTxt = Number.isFinite(ship) ? (ship > 0 ? `+ ${brl(ship)} de frete` : 'frete grátis') : '+ frete';
  const diff = Math.abs(Number(c.difference) || 0);
  let verdict;
  let shopWins = true;
  if (c.verdict === 'online_mais_barato') {
    verdict = `Online sai ${brl(diff)} mais barato — mas aqui você leva hoje e testa antes.`;
    shopWins = false;
  } else if (c.verdict === 'empate') {
    verdict = 'Preço praticamente igual — e aqui você leva hoje, sem esperar entrega.';
  } else {
    verdict = `No shopping você economiza ${brl(diff)} e leva hoje.`;
  }
  const adv = Array.isArray(c.advantages) && c.advantages.length ? c.advantages : ['Leva hoje, sem frete', 'Testa antes de pagar', 'Troca na hora, no balcão'];
  return `<section class="compare" aria-label="Comparativo de preço online e no shopping">
    <div class="compare-head">${icon('tag')}Online × Shopping</div>
    <div class="compare-rows">
      <div class="compare-col">
        <div class="k">Online</div>
        <div class="v">${brl(c.onlinePrice)}</div>
        <div class="d">${esc(shipTxt)} · ${esc(daysTxt)}</div>
      </div>
      <div class="compare-col ${shopWins ? 'win' : ''}">
        <div class="k">Shopping</div>
        <div class="v">${brl(c.shoppingPrice)}</div>
        <div class="d">${c.basis === 'parecido' ? 'produto parecido · hoje' : 'mesmo produto · hoje'}</div>
      </div>
    </div>
    ${c.basis === 'parecido' ? `<p class="compare-note">${icon('alert')}<span>Atenção: o shopping não tem o mesmo modelo. O preço acima é de um produto <strong>parecido</strong> (outra marca ou versão), então a comparação é aproximada.</span></p>` : ''}
    <p class="compare-verdict">${esc(verdict)}</p>
    <ul class="compare-adv">${adv.slice(0, 4).map((a) => `<li>${icon('check')}<span>${esc(a)}</span></li>`).join('')}</ul>
  </section>`;
}

function resultCard(r, source) {
  const p = r.product || {};
  const st = p.store || {};
  const stock = stockLabel(p.stock);
  const igual = r.match === 'igual';
  const marker = source === 'ia' ? '<span class="reason-tag ia">IA</span>' : '<span class="reason-tag">regra</span>';
  return `<article class="result" data-href="#/produto/${encodeURIComponent(p.id)}">
    ${segMedia(p.segment || st.segment, 'result-media', '', `${p.name} ${p.category}`)}
    <div class="result-body">
      <div class="result-top">
        <span class="tag ${igual ? 'tag-igual' : 'tag-parecido'}">${igual ? icon('check', 'icon-sm') + 'Igual' : 'Parecido'}</span>
        <span>${esc(st.name || 'Loja')}</span><span class="dot-sep">${esc(floorLabel(st.floor))}</span>
      </div>
      <h3 class="result-name">${esc(p.name)}</h3>
      <div class="result-meta">
        <span class="price">${brl(p.price)}</span>
        ${stock.text ? `<span class="stock ${stock.cls}">${esc(stock.text)}</span>` : ''}
      </div>
      ${r.reason ? `<p class="reason">${marker}${esc(r.reason)}</p>` : ''}
      <a class="btn btn-sm btn-secondary result-cta" href="#/produto/${encodeURIComponent(p.id)}">Ver produto ${icon('chevron', 'icon-sm')}</a>
    </div>
  </article>`;
}

function renderResults(ctx) {
  const res = ctx.res || {};
  const results = Array.isArray(res.results) ? res.results.filter((r) => r && r.product) : [];
  const notFound = res.notFound || results.length === 0;
  const nIgual = results.filter((r) => r.match === 'igual').length;
  let body;
  if (notFound) {
    body = `<div class="card empty">
      <div class="empty-ico">${icon('bell')}</div>
      <h2>Ainda não temos isso por aqui</h2>
      <p>Nenhuma loja do shopping tem isso agora. Avisamos os lojistas que você procurou.</p>
      <a class="btn btn-primary btn-block" href="#/">${icon('search')}Tentar outra busca</a>
    </div>`;
  } else {
    const title = nIgual
      ? `${nIgual} ${nIgual === 1 ? 'loja tem igual' : 'opções iguais'}${results.length > nIgual ? ` · ${results.length - nIgual} parecido${results.length - nIgual > 1 ? 's' : ''}` : ''}`
      : `${results.length} ${results.length === 1 ? 'opção parecida' : 'opções parecidas'}`;
    body = `${compareCard(res.comparison)}
      <h2 class="section-title">${esc(title)}<span>no shopping hoje</span></h2>
      <div class="results">${results.map((r) => resultCard(r, res.source)).join('')}</div>`;
  }
  render(`${topbar('Resultados')}
    <div class="page">
      ${queryHead(ctx, res)}
      ${res.warning ? `<div class="banner" role="note">${icon('alert')}<span>${esc(res.warning)}</span></div>` : ''}
      ${body}
      ${ctx.isImage ? `<p class="foot-note">${icon('lock', 'icon-sm')}Sua foto não foi guardada.</p>` : ''}
    </div>`);
  wireBackTo('#/');
  $$('.result', root).forEach((card) =>
    card.addEventListener('click', (e) => {
      if (e.target.closest('a,button')) return;
      location.hash = card.dataset.href;
    }),
  );
}

// ---------- 3. Produto ----------
function viewProduct(id) {
  const token = viewToken;
  const cached = productCache.get(String(id));
  if (cached) renderProduct(cached, null);
  else
    render(`${topbar('Produto')}
      <div class="page" aria-busy="true">
        <div class="skel" style="height:220px;border-radius:22px"></div>
        <div class="skel" style="height:24px;width:80%"></div>
        <div class="skel" style="height:16px;width:50%"></div>
        <div class="skel" style="height:32px;width:40%"></div>
        <div class="skel" style="height:56px;border-radius:16px"></div>
      </div>`);
  if (!cached) wireBackTo('#/resultados');
  api('/api/product', { query: { id } }).then(
    (data) => {
      if (token !== viewToken || !data.product) return;
      cacheProducts([data.product, ...(data.similar || [])]);
      renderProduct(data.product, data.similar || []);
    },
    (err) => {
      if (token !== viewToken) return;
      if (cached) return; // já mostramos o que tínhamos
      showError(err, 'Não consegui abrir o produto');
      render(`${topbar('Produto')}
        <div class="page"><div class="card empty">
          <div class="empty-ico">${icon('alert')}</div>
          <h2>${err.status === 404 ? 'Produto não encontrado' : 'Não deu para abrir o produto'}</h2>
          <p>${err.status === 404 ? 'Talvez ele tenha saído do catálogo.' : 'Verifique a conexão e tente de novo.'}</p>
          <a class="btn btn-primary" href="#/">Nova busca</a>
        </div></div>`);
      wireBackTo('#/resultados');
    },
  );
}

function renderProduct(p, similar) {
  const st = p.store || {};
  const seg = segmentInfo(p.segment || st.segment);
  const stock = stockLabel(p.stock);
  const noStock = Number(p.stock) <= 0;
  const unit = st.unit ? (/^\d+$/.test(String(st.unit)) ? `Loja ${st.unit}` : String(st.unit)) : '';
  const onRoute = inRoteiro(p.id);
  const sim = Array.isArray(similar) ? similar.filter((s) => s && s.id && String(s.id) !== String(p.id)) : null;
  render(`${topbar(st.name || 'Produto')}
    <div class="page">
      ${segMedia(p.segment || st.segment, 'product-media', `<span class="seg-label">${esc(p.category || seg.label)}</span>`, `${p.name} ${p.category}`)}
      <div style="display:grid;gap:8px">
        <h2 class="product-title">${esc(p.name)}</h2>
        <div class="where">${icon('store', 'icon-sm')}<span>${esc(st.name || 'Loja')}</span>
          ${st.floor !== undefined && st.floor !== null ? `<span class="dot-sep">${esc(floorLabel(st.floor))}</span>` : ''}
          ${unit ? `<span class="dot-sep">${esc(unit)}</span>` : ''}</div>
        <div class="result-meta"><span class="price-big">${brl(p.price)}</span>${stock.text ? `<span class="stock ${stock.cls}">${esc(stock.text)}</span>` : ''}</div>
        ${p.brand || p.color ? `<p class="muted small">${[p.brand && `Marca ${esc(p.brand)}`, p.color && `Cor ${esc(p.color)}`].filter(Boolean).join(' · ')}</p>` : ''}
        ${p.description ? `<p style="color:var(--ink-2)">${esc(p.description)}</p>` : ''}
      </div>

      <div class="actions">
        <button type="button" class="btn btn-primary btn-lg btn-block" data-reserve="separar" ${noStock ? 'disabled' : ''}>${icon('bag')}Separa pra mim</button>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" data-reserve="testar" ${noStock ? 'disabled' : ''}>${icon('hand')}Quero testar na loja</button>
          <button type="button" class="btn btn-outline" id="add-route" aria-pressed="${onRoute}" style="flex:0 0 auto">${onRoute ? icon('check') + 'No roteiro' : icon('plus') + 'Roteiro'}</button>
        </div>
        ${noStock ? '<p class="small muted">Sem estoque agora — veja as opções parecidas abaixo.</p>' : ''}
      </div>

      <section class="card why" aria-labelledby="why-title">
        <h2 class="section-title" id="why-title">Por que ir à loja</h2>
        <div class="why-item"><span class="why-ico">${icon('truck')}</span><div><strong>Leve hoje, sem frete</strong><span>Nada de esperar a entrega.</span></div></div>
        <div class="why-item"><span class="why-ico">${icon('hand')}</span><div><strong>Teste antes de pagar</strong><span>Veja, toque e experimente de verdade.</span></div></div>
        <div class="why-item"><span class="why-ico">${icon('swap')}</span><div><strong>Troca na hora, no balcão</strong><span>Sem correio, sem etiqueta de devolução.</span></div></div>
      </section>

      ${
        sim === null
          ? ''
          : sim.length
            ? `<section aria-labelledby="sim-title">
              <h2 class="section-title" id="sim-title" style="margin-bottom:10px">Parecidos no shopping</h2>
              <div class="hscroll">${sim
                .slice(0, 10)
                .map(
                  (s) => `<a class="mini" href="#/produto/${encodeURIComponent(s.id)}">
                  ${segMedia(s.segment || (s.store || {}).segment, 'mini-media', '', `${s.name} ${s.category}`)}
                  <div class="mini-body"><span class="mini-name">${esc(s.name)}</span><span class="mini-price">${brl(s.price)}</span><span class="mini-store">${esc((s.store || {}).name || '')}${(s.store || {}).floor != null ? ' · ' + esc(floorLabel(s.store.floor)) : ''}</span></div>
                </a>`,
                )
                .join('')}</div>
            </section>`
            : ''
      }
    </div>`);
  wireBackTo('#/resultados');
  $$('[data-reserve]', root).forEach((b) => b.addEventListener('click', () => openReserveSheet(p, b.dataset.reserve)));
  $('#add-route', root).addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (inRoteiro(p.id)) {
      setRoteiro(getRoteiro().filter((x) => String(x.id) !== String(p.id)));
      btn.innerHTML = `${icon('plus')}Roteiro`;
      btn.setAttribute('aria-pressed', 'false');
      toast('Removido do roteiro.');
    } else {
      addToRoteiro(p);
      btn.innerHTML = `${icon('check')}No roteiro`;
      btn.setAttribute('aria-pressed', 'true');
      toast('Adicionado ao seu roteiro.', { type: 'success' });
    }
  });
}

// ---------- Folha de reserva (apelido) ----------
const sheet = $('#reserve-sheet');
const sheetForm = $('#reserve-form');
let sheetProduct = null;

function openReserveSheet(p, type) {
  sheetProduct = p;
  $(`#type-${type === 'testar' ? 'testar' : 'separar'}`).checked = true;
  syncSheetTitle();
  const st = p.store || {};
  $('#reserve-product').textContent = `${p.name} · ${st.name || 'Loja'}${st.floor != null ? ' · ' + floorLabel(st.floor) : ''}`;
  const nick = $('#nickname');
  nick.value = local.get('nickname', '') || '';
  nick.removeAttribute('aria-invalid');
  $('#nickname-error').hidden = true;
  if (typeof sheet.showModal === 'function') sheet.showModal();
  else sheet.setAttribute('open', '');
  setTimeout(() => nick.focus(), 60);
}

function syncSheetTitle() {
  const testar = $('#type-testar').checked;
  $('#reserve-title').textContent = testar ? 'Testar na loja' : 'Separar na loja';
  $('#reserve-submit').textContent = testar ? 'Pedir para testar' : 'Separar pra mim';
}
$$('input[name="type"]', sheetForm).forEach((r) => r.addEventListener('change', syncSheetTitle));

function closeSheet() {
  if (typeof sheet.close === 'function' && sheet.open) sheet.close();
  else sheet.removeAttribute('open');
}
$('[data-close]', sheetForm).addEventListener('click', closeSheet);
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) closeSheet(); // toque no fundo fecha
});

sheetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nickEl = $('#nickname');
  const nickname = nickEl.value.trim().replace(/\s+/g, ' ');
  const errEl = $('#nickname-error');
  if (nickname.length < 1 || nickname.length > 30) {
    errEl.textContent = 'Digite um apelido de 1 a 30 caracteres.';
    errEl.hidden = false;
    nickEl.setAttribute('aria-invalid', 'true');
    nickEl.focus();
    return;
  }
  errEl.hidden = true;
  nickEl.removeAttribute('aria-invalid');
  const type = $('#type-testar').checked ? 'testar' : 'separar';
  const p = sheetProduct;
  if (!p) return;
  const btn = $('#reserve-submit');
  try {
    const data = await withBusy(btn, () => api('/api/reservations', { method: 'POST', body: { productId: p.id, type, nickname } }), 'Enviando…');
    const r = data.reservation;
    if (!r || !r.code) throw new Error('Resposta sem código de reserva.');
    if (!r.product) r.product = p;
    local.set('nickname', nickname);
    upsertReserva(r);
    session.set(`res.${r.code}`, r);
    closeSheet();
    location.hash = `#/reserva/${encodeURIComponent(r.code)}`;
  } catch (err) {
    showError(err, 'Não deu para enviar o pedido');
  }
});

// ---------- 4. Reserva ----------
const STATUS = {
  aguardando: { pill: 'Aguardando a loja', title: 'Pedido enviado!', sub: 'A loja já recebeu. Esta tela atualiza sozinha quando ela confirmar.', ico: 'clock', cls: 'wait' },
  confirmada: { pill: 'Confirmada pela loja', title: 'Separado pra você!', sub: 'Pode ir até a loja. Mostre o QR no balcão.', ico: 'check', cls: '' },
  recusada: { pill: 'Recusada', title: 'A loja não conseguiu separar', sub: 'Pode ter acabado agora. Veja opções parecidas.', ico: 'x', cls: 'no' },
  retirada: { pill: 'Retirada', title: 'Retirado. Aproveite!', sub: 'Obrigado por comprar no shopping.', ico: 'check', cls: '' },
};

function viewReservation(code) {
  const token = viewToken;
  const cached = session.get(`res.${code}`);
  let lastStatus = cached ? cached.status : null;
  if (cached) renderReservation(cached);
  else
    render(`${topbar('Reserva')}
      <div class="page" aria-busy="true">
        <div class="skel" style="height:140px;border-radius:22px"></div>
        <div class="skel" style="height:300px;border-radius:16px"></div>
      </div>`);
  if (!cached) wireBackTo('#/reservas');

  let timer = null;
  const load = async (first) => {
    try {
      const data = await api('/api/reservations', { query: { code } });
      if (token !== viewToken) return;
      const r = data.reservation;
      if (!r) return;
      if (!r.product && cached && cached.product) r.product = cached.product;
      session.set(`res.${code}`, r);
      upsertReserva(r);
      if (lastStatus === 'aguardando' && r.status === 'confirmada') {
        toast('A loja confirmou! Seu produto está separado.', { type: 'success' });
        if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
      }
      if (lastStatus === 'aguardando' && r.status === 'recusada') toast('A loja não conseguiu separar desta vez.', { type: 'error' });
      if (lastStatus === 'confirmada' && r.status === 'retirada') toast('Retirada confirmada. Boas compras!', { type: 'success' });
      const changed = r.status !== lastStatus || first;
      lastStatus = r.status;
      if (changed) renderReservation(r);
      else {
        const u = $('#updated', root);
        if (u) u.textContent = `Atualizado às ${fmtTime(new Date())}`;
      }
      schedule(r.status);
    } catch (err) {
      if (token !== viewToken) return;
      if (first && !cached) {
        showError(err, 'Não consegui abrir a reserva');
        render(`${topbar('Reserva')}
          <div class="page"><div class="card empty">
            <div class="empty-ico">${icon('alert')}</div>
            <h2>${err.status === 404 ? 'Reserva não encontrada' : 'Não deu para abrir a reserva'}</h2>
            <p>${err.status === 404 ? 'Confira o código ou faça uma nova busca.' : 'Verifique a conexão e tente de novo.'}</p>
            <a class="btn btn-primary" href="#/reservas">Minhas reservas</a>
          </div></div>`);
        wireBackTo('#/reservas');
      }
      schedule(lastStatus || 'aguardando'); // continua tentando em silêncio
    }
  };
  const schedule = (status) => {
    clearTimeout(timer);
    // Continua acompanhando até a retirada: aguardando (5 s) e confirmada (10 s)
    const wait = status === 'aguardando' ? 5000 : status === 'confirmada' ? 10000 : 0;
    if (wait && token === viewToken) timer = setTimeout(() => load(false), wait);
  };
  cleanup.push(() => clearTimeout(timer));
  load(true);
}

function renderReservation(r) {
  const s = STATUS[r.status] || STATUS.aguardando;
  const p = r.product || {};
  const st = p.store || {};
  const unit = st.unit ? (/^\d+$/.test(String(st.unit)) ? `Loja ${st.unit}` : String(st.unit)) : '';
  const placeLine = [floorLabel(st.floor), unit].filter(Boolean).join(' · ');
  const active = r.status === 'aguardando' || r.status === 'confirmada';
  render(`${topbar('Sua reserva')}
    <div class="page">
      <div class="res-hero">
        <div class="big-check ${s.cls}" aria-hidden="true">${icon(s.ico)}</div>
        <h2 class="res-title">${esc(s.title)}</h2>
        <span class="pill pill-${esc(r.status || 'aguardando')}" role="status">${esc(s.pill)}</span>
        <p class="muted small" style="max-width:34ch">${esc(s.sub)}</p>
      </div>

      ${
        r.status !== 'recusada'
          ? `<section class="card qr-card" aria-label="QR Code da reserva">
        <div class="qr-box" id="qr"></div>
        <div class="res-code" aria-label="Código ${esc(String(r.code).split('').join(' '))}">${esc(r.code)}</div>
        <p class="muted small">${r.status === 'retirada' ? 'Retirada registrada pela loja.' : 'Mostre o QR no balcão da loja'}</p>
      </section>`
          : ''
      }

      <section class="card kv" aria-label="Detalhes">
        <div class="kv-row">${icon('bag')}<div><div class="k">${r.type === 'testar' ? 'Para testar na loja' : 'Separado para retirar'}</div><div class="v">${esc(p.name || 'Produto')}${p.price != null ? ` · ${brl(p.price)}` : ''}</div></div></div>
        <div class="kv-row">${icon('store')}<div><div class="k">${esc(placeLine || 'Loja')}</div><div class="v">${esc(st.name || 'Loja')}</div></div></div>
        ${active && r.expires_at ? `<div class="kv-row">${icon('clock')}<div><div class="k">Prazo</div><div class="v">Retire até ${esc(fmtTime(r.expires_at))}</div></div></div>` : ''}
        ${r.nickname ? `<div class="kv-row">${icon('user')}<div><div class="k">A loja vai chamar</div><div class="v">${esc(r.nickname)}</div></div></div>` : ''}
      </section>

      <div class="actions">
        ${
          r.status === 'recusada' && (p.id || r.product_id)
            ? `<a class="btn btn-primary btn-lg btn-block" href="#/produto/${encodeURIComponent(p.id || r.product_id)}">Ver opções parecidas</a>`
            : `<button type="button" class="btn btn-primary btn-lg btn-block" id="to-route">${icon('route')}Ver no roteiro</button>`
        }
        <a class="btn btn-ghost btn-block" href="#/reservas">Minhas reservas</a>
      </div>
      ${r.status === 'aguardando' ? `<p class="updated" id="updated" aria-live="off">Atualiza a cada 5 segundos</p>` : ''}
    </div>`);
  wireBackTo('#/reservas');
  const qr = $('#qr', root);
  if (qr) {
    try {
      qr.innerHTML = qrSVG(String(r.code), { label: `QR Code da reserva ${r.code}` });
    } catch {
      qr.textContent = r.code;
    }
  }
  const toRoute = $('#to-route', root);
  if (toRoute)
    toRoute.addEventListener('click', () => {
      if (p.id) addToRoteiro(p);
      location.hash = '#/roteiro';
    });
}

// ---------- Minhas reservas ----------
function viewReservations() {
  const token = viewToken;
  const list = getReservas();
  const draw = (items) => {
    render(`${topbar('Minhas reservas', false)}
      <div class="page">
        ${
          items.length
            ? `<div class="list">${items
                .map((r) => {
                  const s = STATUS[r.status] || null;
                  return `<a class="list-item" href="#/reserva/${encodeURIComponent(r.code)}">
                  ${segMedia(r.segment, 'chip-ico', '')}
                  <div class="grow">
                    <div class="title">${esc(r.productName || 'Produto')}</div>
                    <div class="sub">${esc(r.storeName || '')}${r.floor != null ? ' · ' + esc(floorLabel(r.floor)) : ''} · ${esc(relTime(r.createdAt))}</div>
                  </div>
                  <div style="display:grid;gap:4px;justify-items:end">
                    <span class="code-chip">${esc(r.code)}</span>
                    ${s ? `<span class="pill pill-${esc(r.status)}" style="padding:2px 8px;font-size:.72rem">${esc(s.pill.replace(' pela loja', '').replace('Aguardando a loja', 'Aguardando'))}</span>` : ''}
                  </div>
                </a>`;
                })
                .join('')}</div>`
            : `<div class="card empty">
              <div class="empty-ico">${icon('ticket')}</div>
              <h2>Nenhuma reserva ainda</h2>
              <p>Busque um produto e toque em “Separa pra mim”. A loja confirma e você retira hoje.</p>
              <a class="btn btn-primary" href="#/">${icon('search')}Buscar produto</a>
            </div>`
        }
        <p class="foot-note">${icon('lock', 'icon-sm')}Suas reservas ficam só neste aparelho.</p>
      </div>`);
  };
  draw(list);
  // Atualiza os status em segundo plano (sem travar a tela)
  const pending = list.filter((r) => r.status !== 'retirada' && r.status !== 'recusada').slice(0, 8);
  if (!pending.length) return;
  Promise.allSettled(pending.map((r) => api('/api/reservations', { query: { code: r.code } }))).then((rs) => {
    if (token !== viewToken) return;
    let changed = false;
    rs.forEach((x) => {
      if (x.status === 'fulfilled' && x.value.reservation) {
        upsertReserva(x.value.reservation);
        changed = true;
      }
    });
    if (changed) draw(getReservas());
  });
}

// ---------- 5. Roteiro ----------
function viewRoute() {
  const token = viewToken;
  const items = getRoteiro();
  if (!items.length) {
    render(`${topbar('Meu roteiro', false)}
      <div class="page">
        <div class="card empty">
          <div class="empty-ico">${icon('route')}</div>
          <h2>Seu roteiro está vazio</h2>
          <p>Toque em “+ Roteiro” nos produtos. A gente organiza a visita por piso, para você andar menos.</p>
          <a class="btn btn-primary" href="#/">${icon('search')}Buscar produtos</a>
        </div>
      </div>`);
    return;
  }
  render(`${topbar('Meu roteiro', false)}
    <div class="page" aria-busy="true">
      <div class="skel" style="height:72px;border-radius:14px"></div>
      <div class="skel" style="height:120px;border-radius:14px"></div>
      <div class="skel" style="height:120px;border-radius:14px"></div>
    </div>`);
  api('/api/route', { method: 'POST', body: { productIds: items.map((x) => x.id) } }).then(
    (data) => {
      if (token !== viewToken) return;
      const stops = Array.isArray(data.stops) ? data.stops : [];
      stops.forEach((s) => cacheProducts(s.products));
      renderRoute(stops, data.summary);
    },
    (err) => {
      if (token !== viewToken) return;
      showError(err, 'Não consegui montar o roteiro agora');
      renderRoute(localStops(items), null); // plano B: organiza aqui mesmo
    },
  );
}

function floorNum(f) {
  const n = parseInt(String(f ?? '').replace(/\D+/g, ''), 10);
  if (/t[ée]rreo/i.test(String(f))) return 0;
  return Number.isFinite(n) ? n : 99;
}

function localStops(items) {
  const byStore = new Map();
  for (const it of items) {
    const k = it.storeName || 'Loja';
    if (!byStore.has(k)) byStore.set(k, { store: { name: k, floor: it.floor, unit: it.unit }, floor: it.floor, products: [] });
    byStore.get(k).products.push({ id: it.id, name: it.name, price: it.price, segment: it.segment });
  }
  return [...byStore.values()].sort((a, b) => floorNum(a.floor) - floorNum(b.floor)).map((s, i) => ({ ...s, order: i + 1 }));
}

function renderRoute(stops, summary) {
  const allProducts = stops.flatMap((s) => s.products || []);
  const total = allProducts.reduce((acc, p) => acc + (Number(p.price) || 0), 0);
  const floors = new Set(stops.map((s) => String(s.floor ?? (s.store || {}).floor)));
  const summaryText = typeof summary === 'string' ? summary : summary && (summary.text || summary.message || summary.tip);
  render(`${topbar('Meu roteiro', false)}
    <div class="page">
      <div class="summary" role="group" aria-label="Resumo do roteiro">
        <div><div class="n">${stops.length}</div><div class="l">${stops.length === 1 ? 'loja' : 'lojas'}</div></div>
        <div><div class="n">${floors.size}</div><div class="l">${floors.size === 1 ? 'piso' : 'pisos'}</div></div>
        <div><div class="n" style="font-size:1.05rem;line-height:1.55">${brl(total)}</div><div class="l">total</div></div>
      </div>
      <p class="small muted">${esc(summaryText || 'Ordem pensada por piso, para você andar menos. Comece pela parada 1.')}</p>
      <ol class="stops">
        ${stops
          .map((s, i) => {
            const st = s.store || {};
            const unit = st.unit ? (/^\d+$/.test(String(st.unit)) ? `Loja ${st.unit}` : String(st.unit)) : '';
            return `<li class="stop">
              <span class="stop-num" aria-label="Parada ${s.order || i + 1}">${s.order || i + 1}</span>
              <div class="stop-card">
                <div class="stop-head"><strong>${esc(st.name || 'Loja')}</strong><span class="floor-badge">${esc([floorLabel(s.floor ?? st.floor), unit].filter(Boolean).join(' · '))}</span></div>
                ${(s.products || [])
                  .map(
                    (p) => `<div class="stop-prod">
                    <a class="grow" href="#/produto/${encodeURIComponent(p.id)}" style="color:inherit;text-decoration:none"><div style="font-weight:650">${esc(p.name)}</div><div class="small muted">${brl(p.price)}</div></a>
                    <button type="button" class="icon-btn" data-remove="${esc(p.id)}" aria-label="Remover ${esc(p.name)} do roteiro">${icon('trash')}</button>
                  </div>`,
                  )
                  .join('')}
              </div>
            </li>`;
          })
          .join('')}
      </ol>
      <a class="btn btn-outline btn-block" href="#/">${icon('plus')}Adicionar mais produtos</a>
    </div>`);
  $$('[data-remove]', root).forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.remove;
      setRoteiro(getRoteiro().filter((x) => String(x.id) !== String(id)));
      toast('Removido do roteiro.');
      router();
    }),
  );
}

// ---------- Início ----------
window.addEventListener('hashchange', router);
window.addEventListener('unhandledrejection', (e) => {
  console.warn('Promessa não tratada', e.reason);
});
updateBadges();
router();
