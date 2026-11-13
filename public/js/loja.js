// Tela do lojista: login por código da loja, reservas por status, confirmar/recusar e check-in (QR ou digitado).
import { api } from './api.js';
import { icon, esc, brl, floorLabel, fmtTime, relTime, session, toast, showError, withBusy, $, $$ } from './ui.js';

const root = $('#root');
const state = { code: session.get('storeCode', null), store: null, reservations: [], tab: 'pendentes', seen: null, timer: null };

const TABS = [
  { key: 'pendentes', label: 'Pendentes', match: (r) => r.status === 'aguardando' },
  { key: 'confirmadas', label: 'Confirmadas', match: (r) => r.status === 'confirmada' },
  { key: 'historico', label: 'Histórico', match: (r) => r.status === 'recusada' || r.status === 'retirada' },
];

const STATUS_PILL = {
  aguardando: ['aguardando', 'Aguardando'],
  confirmada: ['confirmada', 'Confirmada'],
  recusada: ['recusada', 'Recusada'],
  retirada: ['retirada', 'Retirada'],
};

const auth = () => ({ 'x-store-code': state.code });

function normalizeCode(v) {
  let c = String(v || '').trim().toUpperCase().replace(/\s+/g, '');
  if (/^\d{3,6}$/.test(c)) c = `PT-${c}`;
  if (/^PT\d+$/.test(c)) c = `PT-${c.slice(2)}`;
  return c;
}

function storeSub(st) {
  const unit = st.unit ? (/^\d+$/.test(String(st.unit)) ? `Loja ${st.unit}` : st.unit) : '';
  return [floorLabel(st.floor), unit, 'Ponte Lojista'].filter(Boolean).join(' · ');
}

// ---------- Login ----------
function renderLogin(error) {
  stopPolling();
  root.innerHTML = `<div class="login-wrap">
    <form class="login-card" id="login-form" novalidate>
      <div class="brand"><div class="brand-mark">${icon('bridge')}</div><span class="brand-name">Ponte <span class="muted" style="font-weight:600;font-size:1rem">Lojista</span></span></div>
      <div>
        <h1>Entrar na sua loja</h1>
        <p class="muted small" style="margin-top:4px">Veja as reservas dos clientes e confirme em um toque.</p>
      </div>
      <div>
        <label class="field-label" for="store-code">Código da loja</label>
        <input class="input input-code" id="store-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="Ex.: SOM112" required>
        <p class="field-error" id="login-error" ${error ? '' : 'hidden'}>${esc(error || '')}</p>
      </div>
      <button class="btn btn-primary btn-lg btn-block" type="submit" id="login-btn">Entrar</button>
      <p class="foot-note">${icon('lock', 'icon-sm')}O código fica só nesta aba do navegador.</p>
    </form>
  </div>`;
  const input = $('#store-code');
  input.focus();
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = input.value.trim().toUpperCase();
    const errEl = $('#login-error');
    if (!code) {
      errEl.textContent = 'Digite o código da loja.';
      errEl.hidden = false;
      input.focus();
      return;
    }
    try {
      const data = await withBusy($('#login-btn'), () => api('/api/store-login', { method: 'POST', body: { code } }), 'Entrando…');
      state.code = code;
      state.store = data.store;
      session.set('storeCode', code);
      state.seen = null;
      renderMain();
      refresh(true);
    } catch (err) {
      if (err.status === 401 || err.status === 403 || err.status === 404) {
        errEl.textContent = 'Código não encontrado. Confira com a administração do shopping.';
        errEl.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.select();
      } else showError(err, 'Não deu para entrar agora');
    }
  });
}

function logout() {
  session.remove('storeCode');
  state.code = null;
  state.store = null;
  state.reservations = [];
  renderLogin();
}

// ---------- Principal ----------
function renderMain() {
  const st = state.store || {};
  root.innerHTML = `
    <header class="ops-header">
      <div class="ops-header-inner">
        <div class="brand-mark">${icon('bridge')}</div>
        <div class="ops-title">
          <div class="t" id="store-name">${esc(st.name || 'Sua loja')}</div>
          <div class="s" id="store-sub">${esc(storeSub(st))}</div>
        </div>
        <button class="icon-btn" type="button" id="refresh-btn" aria-label="Atualizar agora">${icon('refresh')}</button>
        <button class="icon-btn" type="button" id="logout-btn" aria-label="Sair">${icon('logout')}</button>
      </div>
    </header>
    <main class="ops-main">
      <div class="ops-grid loja">
        <section class="checkin panel-card sticky-side" aria-labelledby="checkin-title" style="order:0">
          <div class="panel-card-head"><div><h2 id="checkin-title">Check-in de retirada</h2><p>Leia o QR do cliente ou digite o código.</p></div>${icon('qr', 'icon-lg')}</div>
          <form id="checkin-form" class="checkin" novalidate>
            <label class="sr-only" for="checkin-code">Código da reserva</label>
            <div class="checkin-row">
              <input class="input input-code" id="checkin-code" placeholder="PT-4821" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" inputmode="text">
              <button class="btn btn-primary" type="submit" id="checkin-btn">Confirmar</button>
            </div>
            ${'BarcodeDetector' in window ? `<button class="btn btn-secondary btn-block" type="button" id="scan-btn">${icon('camera')}Ler QR com a câmera</button>` : ''}
          </form>
          <div id="checkin-result" aria-live="polite"></div>
        </section>
        <section style="display:grid;gap:12px;align-content:start" aria-labelledby="list-title">
          <h2 class="sr-only" id="list-title">Reservas</h2>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span class="live" id="live">Atualiza a cada 10 s</span>
          </div>
          <div class="tabs" role="tablist" aria-label="Status das reservas">
            ${TABS.map((t) => `<button class="tab" role="tab" type="button" id="tab-${t.key}" data-tab="${t.key}" aria-selected="${state.tab === t.key}" aria-controls="res-panel">${t.label}<span class="count" data-count="${t.key}">0</span></button>`).join('')}
          </div>
          <div id="res-panel" role="tabpanel" aria-labelledby="tab-${state.tab}">
            <div class="res-list">${'<div class="skel" style="height:150px;border-radius:16px"></div>'.repeat(2)}</div>
          </div>
        </section>
      </div>
    </main>`;
  $('#logout-btn').addEventListener('click', logout);
  $('#refresh-btn').addEventListener('click', (e) => withBusy(e.currentTarget, () => refresh(false)));
  $$('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      $$('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $('#res-panel').setAttribute('aria-labelledby', `tab-${state.tab}`);
      renderList();
    }),
  );
  // Setas do teclado entre abas
  $('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = $$('[data-tab]');
    const i = tabs.findIndex((t) => t.dataset.tab === state.tab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    next.click();
  });
  $('#checkin-form').addEventListener('submit', (e) => {
    e.preventDefault();
    doCheckin($('#checkin-code').value);
  });
  const scan = $('#scan-btn');
  if (scan) scan.addEventListener('click', openCamera);
}

async function refresh(first) {
  if (!state.code) return;
  try {
    const data = await api('/api/store-reservations', { headers: auth() });
    if (data.store) {
      const had = !!state.store;
      state.store = data.store;
      if (!had || first) {
        const n = $('#store-name');
        if (n) n.textContent = data.store.name || 'Sua loja';
        const sub = $('#store-sub');
        if (sub) sub.textContent = storeSub(data.store);
      }
    }
    const list = Array.isArray(data.reservations) ? data.reservations : [];
    const pendingIds = list.filter((r) => r.status === 'aguardando').map((r) => r.id);
    const fresh = state.seen ? pendingIds.filter((id) => !state.seen.has(id)) : [];
    state.seen = new Set([...(state.seen || []), ...pendingIds]);
    state.reservations = list;
    renderList(new Set(fresh));
    if (fresh.length) {
      toast(fresh.length === 1 ? 'Nova reserva chegou!' : `${fresh.length} novas reservas chegaram!`, { type: 'success' });
      if (navigator.vibrate) navigator.vibrate(80);
    }
    const live = $('#live');
    if (live) live.textContent = `Atualizado às ${fmtTime(new Date())} · a cada 10 s`;
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      toast('Sessão da loja expirou. Entre de novo.', { type: 'error' });
      logout();
      return;
    }
    if (first) showError(err, 'Não consegui carregar as reservas');
    const live = $('#live');
    if (live) live.textContent = 'Sem conexão — tentando de novo…';
  } finally {
    schedule();
  }
}

function schedule() {
  stopPolling();
  if (state.code) state.timer = setTimeout(() => refresh(false), 10000);
}

function stopPolling() {
  clearTimeout(state.timer);
  state.timer = null;
}

function card(r, isNew) {
  const p = r.product || {};
  const pill = STATUS_PILL[r.status] || STATUS_PILL.aguardando;
  const testar = r.type === 'testar';
  let actions = '';
  if (r.status === 'aguardando') {
    actions = `<div class="btn-row">
      <button type="button" class="btn btn-danger" data-act="recusar" data-id="${esc(r.id)}">${icon('x')}Recusar</button>
      <button type="button" class="btn btn-success" data-act="confirmar" data-id="${esc(r.id)}">${icon('check')}Confirmar</button>
    </div>`;
  } else if (r.status === 'confirmada') {
    actions = `<button type="button" class="btn btn-outline btn-block" data-pickup="${esc(r.code)}">${icon('qr')}Registrar retirada</button>`;
  }
  return `<article class="res-card ${isNew ? 'is-new' : ''}" aria-label="Reserva ${esc(r.code)}">
    <div class="res-card-head">
      <span class="type-badge ${testar ? 'testar' : ''}">${icon(testar ? 'hand' : 'bag', 'icon-sm')}${testar ? 'Testar na loja' : 'Separar'}</span>
      ${r.status === 'aguardando' ? `<span class="small muted">${esc(relTime(r.created_at))}</span>` : `<span class="pill pill-${pill[0]}" style="padding:3px 10px;font-size:.78rem">${pill[1]}</span>`}
    </div>
    <div class="prod">${esc(p.name || 'Produto')}</div>
    <div class="who">
      <span>${icon('user')}<strong>${esc(r.nickname || '—')}</strong></span>
      <span>${icon('clock')}${esc(fmtTime(r.created_at))}</span>
      ${p.price != null ? `<span>${icon('tag')}${brl(p.price)}</span>` : ''}
      <span class="code-chip">${esc(r.code)}</span>
    </div>
    ${r.status === 'confirmada' && r.expires_at ? `<p class="small muted">Segurar até ${esc(fmtTime(r.expires_at))}</p>` : ''}
    ${actions}
  </article>`;
}

function renderList(fresh = new Set()) {
  const panel = $('#res-panel');
  if (!panel) return;
  for (const t of TABS) {
    const c = $(`[data-count="${t.key}"]`);
    if (c) c.textContent = String(state.reservations.filter(t.match).length);
  }
  const tab = TABS.find((t) => t.key === state.tab) || TABS[0];
  const items = state.reservations.filter(tab.match);
  if (!items.length) {
    const msg = {
      pendentes: ['Nenhuma reserva pendente', 'Quando um cliente pedir para separar ou testar, aparece aqui na hora.'],
      confirmadas: ['Nada aguardando retirada', 'Reservas confirmadas aparecem aqui até o cliente chegar.'],
      historico: ['Histórico vazio', 'Retiradas e recusas ficam registradas aqui.'],
    }[tab.key];
    panel.innerHTML = `<div class="card empty"><div class="empty-ico">${icon(tab.key === 'pendentes' ? 'bell' : 'list')}</div><h2>${msg[0]}</h2><p>${msg[1]}</p></div>`;
    return;
  }
  panel.innerHTML = `<div class="res-list">${items.map((r) => card(r, fresh.has(r.id))).join('')}</div>`;
  $$('[data-act]', panel).forEach((b) => b.addEventListener('click', () => act(b, b.dataset.id, b.dataset.act)));
  $$('[data-pickup]', panel).forEach((b) => b.addEventListener('click', () => doCheckin(b.dataset.pickup, b)));
}

async function act(btn, id, action) {
  try {
    const data = await withBusy(btn, () => api('/api/store-reservations', { method: 'POST', headers: auth(), body: { id, action } }));
    const updated = data.reservation;
    state.reservations = state.reservations.map((r) => (r.id === id ? { ...r, ...updated, product: updated.product || r.product } : r));
    renderList();
    toast(action === 'confirmar' ? `Confirmada! ${updated.nickname || 'O cliente'} já foi avisado.` : 'Reserva recusada.', {
      type: action === 'confirmar' ? 'success' : 'info',
    });
  } catch (err) {
    showError(err, 'Não deu para atualizar a reserva');
    refresh(false);
  }
}

async function doCheckin(raw, btn) {
  const code = normalizeCode(raw);
  const out = $('#checkin-result');
  const input = $('#checkin-code');
  if (!code) {
    input.focus();
    out.innerHTML = `<div class="checkin-result err">${icon('alert')}Digite o código da reserva (ex.: PT-4821).</div>`;
    return;
  }
  input.value = code;
  try {
    const data = await withBusy(btn || $('#checkin-btn'), () => api('/api/store-checkin', { method: 'POST', headers: auth(), body: { code } }));
    const r = data.reservation || {};
    out.innerHTML = `<div class="checkin-result ok">${icon('checkCircle', 'icon-lg')}<div>Retirada confirmada · <strong>${esc(r.code || code)}</strong><div class="small" style="font-weight:500">${esc((r.product || {}).name || '')}${r.nickname ? ' · ' + esc(r.nickname) : ''}</div></div></div>`;
    input.value = '';
    toast('Retirada registrada. Venda concluída!', { type: 'success' });
    state.reservations = state.reservations.map((x) => (x.code === r.code ? { ...x, ...r, product: r.product || x.product } : x));
    renderList();
    refresh(false);
  } catch (err) {
    const msg = err.status && err.status < 500 ? err.message : 'Não deu para registrar agora.';
    out.innerHTML = `<div class="checkin-result err">${icon('alert')}<div>${esc(msg)}${err.traceId ? ` <span class="small">Código: <code>${esc(err.traceId)}</code></span>` : ''}</div></div>`;
  }
}

// ---------- Câmera (BarcodeDetector) ----------
let stream = null;
let scanTimer = null;
const camSheet = $('#camera-sheet');

async function openCamera() {
  try {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const video = $('#camera-video');
    video.srcObject = stream;
    camSheet.showModal();
    await video.play();
    const tick = async () => {
      if (!stream) return;
      try {
        const codes = await detector.detect(video);
        const hit = codes.find((c) => c.rawValue);
        if (hit) {
          closeCamera();
          $('#checkin-code').value = normalizeCode(hit.rawValue);
          doCheckin(hit.rawValue);
          return;
        }
      } catch {
        /* quadro ainda não pronto */
      }
      scanTimer = setTimeout(tick, 250);
    };
    tick();
  } catch (err) {
    closeCamera();
    toast('Não consegui abrir a câmera. Digite o código da reserva.', { type: 'error' });
    $('#checkin-code').focus();
  }
}

function closeCamera() {
  clearTimeout(scanTimer);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (camSheet.open) camSheet.close();
}

$('#camera-close').addEventListener('click', closeCamera);
camSheet.addEventListener('close', closeCamera);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.code) refresh(false);
});

// ---------- Início ----------
if (state.code) {
  renderMain();
  refresh(true);
} else {
  renderLogin();
}
