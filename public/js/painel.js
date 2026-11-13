// Painel do shopping: indicadores, demanda não atendida, mais buscados, reservas por loja, logs e modo telão.
import { api } from './api.js';
import { icon, esc, floorLabel, fmtTime, fmtDateTime, session, toast, showError, withBusy, $, $$ } from './ui.js';

const root = $('#root');
const telaoEl = $('#telao');
const state = { code: session.get('adminCode', null), tab: 'geral', dash: null, timer: null, logs: { type: '', trace: '' }, telaoTimer: null };

const EVENT_LABEL = {
  busca_realizada: 'Busca',
  busca_sem_resultado: 'Busca sem resultado',
  reserva_criada: 'Reserva criada',
  reserva_confirmada: 'Reserva confirmada',
  reserva_recusada: 'Reserva recusada',
  retirada_confirmada: 'Retirada',
  erro_ia: 'Erro da IA',
  erro_api: 'Erro da API',
};

const auth = () => ({ 'x-admin-code': state.code });
const pct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0%';
  const p = n <= 1 ? n * 100 : n; // aceita fração (0–1) ou porcentagem
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1).replace('.', ',')}%`;
};
const int = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('pt-BR') : '0');

// ---------- Login ----------
function renderLogin(error) {
  stopPolling();
  root.innerHTML = `<div class="login-wrap">
    <form class="login-card" id="login-form" novalidate>
      <div class="brand"><div class="brand-mark">${icon('bridge')}</div><span class="brand-name">Ponte <span class="muted" style="font-weight:600;font-size:1rem">Shopping</span></span></div>
      <div>
        <h1>Painel do shopping</h1>
        <p class="muted small" style="margin-top:4px">Buscas, demanda não atendida, reservas e logs em tempo real.</p>
      </div>
      <div>
        <label class="field-label" for="admin-code">Código de administração</label>
        <input class="input input-code" id="admin-code" type="password" autocomplete="off" spellcheck="false" maxlength="40" placeholder="••••••••" required>
        <p class="field-error" id="login-error" ${error ? '' : 'hidden'}>${esc(error || '')}</p>
      </div>
      <button class="btn btn-primary btn-lg btn-block" type="submit" id="login-btn">Entrar</button>
      <p class="foot-note">${icon('lock', 'icon-sm')}O código fica só nesta aba do navegador.</p>
    </form>
  </div>`;
  const input = $('#admin-code');
  input.focus();
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    const errEl = $('#login-error');
    if (!code) {
      errEl.textContent = 'Digite o código de administração.';
      errEl.hidden = false;
      return;
    }
    try {
      const dash = await withBusy($('#login-btn'), () => api('/api/dashboard', { headers: { 'x-admin-code': code } }), 'Entrando…');
      state.code = code;
      session.set('adminCode', code);
      state.dash = dash;
      renderMain();
      schedule();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        errEl.textContent = 'Código inválido.';
        errEl.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.select();
      } else showError(err, 'Não deu para entrar agora');
    }
  });
}

function logout() {
  session.remove('adminCode');
  state.code = null;
  state.dash = null;
  closeTelao();
  renderLogin();
}

// ---------- Estrutura ----------
function renderMain() {
  root.innerHTML = `
    <header class="ops-header">
      <div class="ops-header-inner">
        <div class="brand-mark">${icon('bridge')}</div>
        <div class="ops-title"><div class="t">Painel do Shopping</div><div class="s">Ponte · Viu online? Resolve hoje no shopping.</div></div>
        <button class="btn btn-sm" type="button" id="telao-btn" aria-label="Modo telão" style="background:rgba(255,255,255,.14);color:#fff">${icon('tv')}<span class="hide-narrow">Modo telão</span></button>
        <button class="icon-btn" type="button" id="logout-btn" aria-label="Sair">${icon('logout')}</button>
      </div>
    </header>
    <main class="ops-main">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div class="tabs" role="tablist" aria-label="Seções do painel" style="flex:0 1 360px">
          <button class="tab" role="tab" type="button" data-tab="geral" id="tab-geral" aria-selected="${state.tab === 'geral'}" aria-controls="panel">${icon('chart', 'icon-sm')}Visão geral</button>
          <button class="tab" role="tab" type="button" data-tab="logs" id="tab-logs" aria-selected="${state.tab === 'logs'}" aria-controls="panel">${icon('list', 'icon-sm')}Logs</button>
        </div>
        <span class="live" id="live">Ao vivo</span>
      </div>
      <div id="panel" role="tabpanel" aria-labelledby="tab-${state.tab}" style="display:grid;gap:16px"></div>
    </main>`;
  $('#logout-btn').addEventListener('click', logout);
  $('#telao-btn').addEventListener('click', openTelao);
  $$('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      $$('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $('#panel').setAttribute('aria-labelledby', `tab-${state.tab}`);
      renderPanel();
    }),
  );
  renderPanel();
}

function renderPanel() {
  if (state.tab === 'logs') renderLogs();
  else renderOverview();
}

async function refresh() {
  if (!state.code) return;
  try {
    state.dash = await api('/api/dashboard', { headers: auth() });
    if (state.tab === 'geral') renderOverview(true);
    if (!telaoEl.hidden) renderTelao();
    const live = $('#live');
    if (live) live.textContent = `Ao vivo · ${fmtTime(new Date())}`;
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      toast('Sessão expirou. Entre de novo.', { type: 'error' });
      logout();
      return;
    }
    const live = $('#live');
    if (live) live.textContent = 'Sem conexão — tentando de novo…';
  } finally {
    schedule();
  }
}

function schedule() {
  stopPolling();
  if (state.code) state.timer = setTimeout(refresh, 15000);
}

function stopPolling() {
  clearTimeout(state.timer);
}

// ---------- Visão geral ----------
function bars(items, { emptyTitle, emptyText, sub }) {
  if (!items || !items.length) {
    return `<div class="empty" style="padding:16px 8px"><div class="empty-ico">${icon('chart')}</div><h2 style="font-size:1rem">${esc(emptyTitle)}</h2><p class="small">${esc(emptyText)}</p></div>`;
  }
  const max = Math.max(...items.map((i) => Number(i.count) || 0), 1);
  return `<ol class="bars">${items
    .map(
      (it, i) => `<li class="bar">
      <span class="bar-rank" aria-hidden="true">${i + 1}</span>
      <span class="bar-label" title="${esc(it.term)}">${esc(it.term)}</span>
      <span class="bar-value" aria-label="${int(it.count)} buscas">${int(it.count)}</span>
      <span class="bar-track" aria-hidden="true"><span class="bar-fill" data-w="${Math.max(4, Math.round(((Number(it.count) || 0) / max) * 100))}"></span></span>
      ${sub ? `<span class="bar-sub">${esc(sub(it))}</span>` : ''}
    </li>`,
    )
    .join('')}</ol>`;
}

function animateBars(scope, instant) {
  const fills = $$('.bar-fill', scope);
  const apply = () => fills.forEach((f) => (f.style.width = `${f.dataset.w}%`));
  if (instant) {
    fills.forEach((f) => (f.style.transition = 'none'));
    apply();
  } else requestAnimationFrame(() => requestAnimationFrame(apply));
}

function renderOverview(isRefresh) {
  const panel = $('#panel');
  if (!panel) return;
  const d = state.dash;
  if (!d) {
    panel.innerHTML = `<div class="kpis">${'<div class="skel" style="height:96px;border-radius:16px"></div>'.repeat(6)}</div>`;
    return;
  }
  const t = d.totals || {};
  const r = d.rates || {};
  const unmet = Array.isArray(d.unmetDemand) ? d.unmetDemand : [];
  const topS = Array.isArray(d.topSearches) ? d.topSearches : [];
  const byStore = Array.isArray(d.byStore) ? d.byStore : [];
  const unmetTotal = unmet.reduce((a, b) => a + (Number(b.count) || 0), 0);
  const scrollY = window.scrollY;

  panel.innerHTML = `
    <section class="kpis" aria-label="Indicadores">
      <div class="kpi"><span class="l">Buscas</span><span class="n">${int(t.searches)}</span><span class="h">texto e foto</span></div>
      <div class="kpi warn"><span class="l">Buscas sem resultado</span><span class="n">${int(t.searchesWithoutResult)}</span><span class="h">${pct(r.searchWithoutResult)} das buscas</span></div>
      <div class="kpi"><span class="l">Reservas</span><span class="n">${int(t.reservations)}</span><span class="h">${int(t.confirmed)} confirmadas · ${int(t.refused)} recusadas</span></div>
      <div class="kpi"><span class="l">Retiradas</span><span class="n">${int(t.pickedUp)}</span><span class="h">vendas na loja física</span></div>
      <div class="kpi accent"><span class="l">Conversão busca → reserva</span><span class="n">${pct(r.searchToReservation)}</span><span class="h">de quem buscou, reservou</span></div>
      <div class="kpi accent"><span class="l">Reserva → retirada</span><span class="n">${pct(r.reservationToPickup)}</span><span class="h">foi até a loja buscar</span></div>
    </section>

    <div class="ops-grid two">
      <section class="panel-card demand" aria-labelledby="unmet-title">
        <div class="panel-card-head">
          <div><h2 id="unmet-title">Demanda não atendida</h2><p>O que os clientes procuraram e nenhuma loja tem. Oportunidade de mix e de nova loja.</p></div>
          <span class="hero-badge">${icon('sparkle', 'icon-sm')}Oportunidade</span>
        </div>
        ${unmetTotal ? `<p class="small" style="color:var(--amber);font-weight:650;margin-top:-4px">${int(unmetTotal)} ${unmetTotal === 1 ? 'busca saiu' : 'buscas saíram'} do shopping sem resposta.</p>` : ''}
        ${bars(unmet, {
          emptyTitle: 'Nenhuma demanda perdida ainda',
          emptyText: 'Quando alguém buscar algo que nenhuma loja tem, aparece aqui.',
          sub: (it) => [it.category, `${int(it.count)} ${Number(it.count) === 1 ? 'pessoa procurou' : 'pessoas procuraram'}`].filter(Boolean).join(' · '),
        })}
      </section>
      <section class="panel-card" aria-labelledby="top-title">
        <div class="panel-card-head"><div><h2 id="top-title">Mais buscados</h2><p>O que está em alta entre os visitantes.</p></div>${icon('search')}</div>
        ${bars(topS, { emptyTitle: 'Sem buscas ainda', emptyText: 'Faça uma busca no app do cliente para ver aqui.', sub: (it) => it.category || '' })}
      </section>
    </div>

    <section class="panel-card" aria-labelledby="stores-title">
      <div class="panel-card-head"><div><h2 id="stores-title">Reservas por loja</h2><p>Do pedido no celular até a retirada no balcão.</p></div>${icon('store')}</div>
      <div class="legend" aria-hidden="true">
        <span><i style="background:#1d4ed8"></i>Retiradas</span>
        <span><i style="background:#16a34a"></i>Confirmadas</span>
        <span><i style="background:#f59e0b"></i>Aguardando</span>
        <span><i style="background:#dc2626"></i>Recusadas</span>
      </div>
      ${storeRows(byStore)}
    </section>
    <p class="small muted" style="text-align:center">${d.updatedAt ? `Atualizado às ${esc(fmtTime(d.updatedAt))}` : ''}${d.period && d.period.events != null ? ` · ${int(d.period.events)} eventos` : ''}</p>`;
  animateBars(panel, isRefresh);
  if (isRefresh) window.scrollTo(0, scrollY);
}

function storeRows(byStore) {
  const rows = byStore.filter((s) => s && s.store);
  if (!rows.length || rows.every((s) => !Number(s.reservations))) {
    return `<div class="empty" style="padding:12px"><p class="small">Ainda sem reservas hoje. ${rows.length ? `${rows.length} lojas participando.` : ''}</p></div>`;
  }
  const max = Math.max(...rows.map((s) => Number(s.reservations) || 0), 1);
  return `<div class="store-rows">${rows
    .filter((s) => Number(s.reservations) > 0)
    .map((s) => {
      const total = Number(s.reservations) || 0;
      const picked = Math.min(Number(s.pickedUp) || 0, total);
      const conf = Math.max(0, (Number(s.confirmed) || 0) - picked);
      const ref = Number(s.refused) || 0;
      const wait = Math.max(0, total - picked - conf - ref);
      const w = (n) => `${((n / max) * 100).toFixed(2)}%`;
      return `<div class="store-row">
        <span class="nm">${esc(s.store.name)} <span class="muted small" style="font-weight:500">· ${esc(floorLabel(s.store.floor))}</span></span>
        <span class="ct">${int(total)} ${total === 1 ? 'reserva' : 'reservas'} · ${int(picked)} ${picked === 1 ? 'retirada' : 'retiradas'}</span>
        <div class="stack-bar" role="img" aria-label="${esc(`${s.store.name}: ${picked} retiradas, ${conf} confirmadas, ${wait} aguardando, ${ref} recusadas`)}">
          <span style="width:${w(picked)};background:#1d4ed8"></span><span style="width:${w(conf)};background:#16a34a"></span><span style="width:${w(wait)};background:#f59e0b"></span><span style="width:${w(ref)};background:#dc2626"></span>
        </div>
      </div>`;
    })
    .join('')}</div>`;
}

// ---------- Logs ----------
function summarizeData(data) {
  if (!data || typeof data !== 'object') return '';
  return Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ')
    .slice(0, 300);
}

function renderLogs() {
  const panel = $('#panel');
  panel.innerHTML = `
    <section class="panel-card" aria-labelledby="logs-title">
      <div class="panel-card-head"><div><h2 id="logs-title">Logs de eventos</h2><p>Cada requisição tem um código de rastreio — o mesmo que o usuário vê nas mensagens de erro.</p></div>${icon('list')}</div>
      <form class="toolbar" id="logs-form" role="search">
        <label class="sr-only" for="log-type">Tipo de evento</label>
        <select class="input" id="log-type" style="flex:0 1 220px">
          <option value="">Todos os tipos</option>
          ${Object.entries(EVENT_LABEL).map(([k, v]) => `<option value="${k}" ${state.logs.type === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <label class="sr-only" for="log-trace">Código de rastreio</label>
        <input class="input input-code" id="log-trace" placeholder="Código (ex.: A7F3K2)" maxlength="12" value="${esc(state.logs.trace)}" autocomplete="off" spellcheck="false">
        <button class="btn btn-primary btn-sm" type="submit" id="logs-btn">${icon('search', 'icon-sm')}Buscar</button>
        <button class="btn btn-outline btn-sm" type="button" id="logs-clear">Limpar</button>
      </form>
      <div id="logs-out"><div class="skel" style="height:220px;border-radius:14px"></div></div>
    </section>`;
  $('#logs-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.logs.type = $('#log-type').value;
    state.logs.trace = $('#log-trace').value.trim().toUpperCase();
    loadLogs($('#logs-btn'));
  });
  $('#log-type').addEventListener('change', () => {
    state.logs.type = $('#log-type').value;
    loadLogs();
  });
  $('#logs-clear').addEventListener('click', () => {
    state.logs = { type: '', trace: '' };
    renderLogs();
  });
  loadLogs();
}

async function loadLogs(btn) {
  const out = $('#logs-out');
  try {
    const run = () => api('/api/logs', { headers: auth(), query: { type: state.logs.type, trace: state.logs.trace, limit: 200 } });
    const data = btn ? await withBusy(btn, run) : await run();
    const events = Array.isArray(data.events) ? data.events : [];
    if (!$('#logs-out')) return;
    if (!events.length) {
      out.innerHTML = `<div class="empty"><div class="empty-ico">${icon('search')}</div><h2 style="font-size:1rem">Nenhum evento encontrado</h2><p class="small">${state.logs.trace ? `Nada com o código ${esc(state.logs.trace)}.` : 'Ajuste os filtros ou use o app para gerar eventos.'}</p></div>`;
      return;
    }
    const nErr = events.filter((e) => /^erro_/.test(e.type)).length;
    out.innerHTML = `<p class="small muted" style="margin-bottom:8px">${int(events.length)} ${events.length === 1 ? 'evento' : 'eventos'}${nErr ? ` · <strong style="color:var(--red)">${int(nErr)} com erro</strong>` : ''}</p>
      <div class="table-wrap"><table class="logs">
        <thead><tr><th scope="col">Quando</th><th scope="col">Tipo</th><th scope="col">Rastreio</th><th scope="col">Detalhes</th></tr></thead>
        <tbody>${events
          .map((e) => {
            const err = /^erro_/.test(e.type);
            const cls = err ? 'err' : e.type === 'busca_sem_resultado' ? 'miss' : /retirada|confirmada/.test(e.type) ? 'ok' : '';
            return `<tr class="${err ? 'err' : ''}">
              <td style="white-space:nowrap">${esc(fmtDateTime(e.created_at))}</td>
              <td><span class="ev-type ${cls}">${esc(EVENT_LABEL[e.type] || e.type)}</span></td>
              <td>${e.trace_id ? `<button type="button" class="trace-btn" data-trace="${esc(e.trace_id)}" aria-label="Filtrar pelo código ${esc(e.trace_id)}">${esc(e.trace_id)}</button>` : '—'}</td>
              <td class="ev-data">${esc(summarizeData(e.data))}</td>
            </tr>`;
          })
          .join('')}</tbody>
      </table></div>`;
    $$('[data-trace]', out).forEach((b) =>
      b.addEventListener('click', () => {
        state.logs.trace = b.dataset.trace;
        state.logs.type = '';
        renderLogs();
      }),
    );
  } catch (err) {
    if (err.status === 401 || err.status === 403) return logout();
    if (err.status === 400) {
      out.innerHTML = `<div class="checkin-result err">${icon('alert')}${esc(err.message)}</div>`;
      return;
    }
    showError(err, 'Não consegui carregar os logs');
    out.innerHTML = `<div class="empty"><p class="small">Não deu para carregar os logs agora.</p></div>`;
  }
}

// ---------- Modo telão ----------
function renderTelao() {
  const d = state.dash || {};
  const list = (items, n) =>
    items && items.length
      ? `<ol class="telao-list">${items
          .slice(0, n)
          .map((it, i) => `<li><span class="r">${i + 1}</span><span class="t">${esc(it.term)}</span><span class="c">${int(it.count)}</span></li>`)
          .join('')}</ol>`
      : '<p style="opacity:.7;font-size:1.2rem">Aguardando as primeiras buscas…</p>';
  telaoEl.innerHTML = `
    <div class="telao-head">
      <div class="brand"><div class="brand-mark">${icon('bridge')}</div><span class="brand-name">Ponte</span></div>
      <button class="btn" type="button" id="telao-close">${icon('x')}Sair do telão</button>
    </div>
    <div style="display:grid;gap:clamp(16px,3vw,36px);align-content:start">
      <h2 class="telao-title">Agora no shopping: <em>o que Palmas está procurando</em></h2>
      <div class="telao-cols">
        <div class="telao-col"><h3>Mais buscados hoje</h3>${list(d.topSearches, 6)}</div>
        <div class="telao-col miss"><h3>Procuram e ainda não encontram</h3>${list(d.unmetDemand, 6)}</div>
      </div>
    </div>
    <div class="telao-foot"><span>Viu online? Resolve hoje no shopping.</span><span>${esc(fmtTime(new Date()))} · ${int((d.totals || {}).searches)} buscas · ${int((d.totals || {}).pickedUp)} retiradas</span></div>`;
  $('#telao-close').addEventListener('click', closeTelao);
}

function openTelao() {
  renderTelao();
  telaoEl.hidden = false;
  document.body.style.overflow = 'hidden';
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  $('#telao-close').focus();
  clearInterval(state.telaoTimer);
  state.telaoTimer = setInterval(() => !telaoEl.hidden && renderTelao(), 30000); // relógio
  refresh();
}

function closeTelao() {
  if (telaoEl.hidden) return;
  telaoEl.hidden = true;
  document.body.style.overflow = '';
  clearInterval(state.telaoTimer);
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  const b = $('#telao-btn');
  if (b) b.focus();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !telaoEl.hidden) closeTelao();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && !telaoEl.hidden) closeTelao();
});

// ---------- Início ----------
if (state.code) {
  renderMain();
  refresh();
} else {
  renderLogin();
}
