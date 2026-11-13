// Utilidades de interface: ícones SVG próprios, escape, formatação, toasts e armazenamento seguro.

const P = {
  bridge: '<path d="M2 18h20"/><path d="M3 14.5C6 7.5 18 7.5 21 14.5"/><path d="M7 18v-7M12 18V9.3M17 18v-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  store: '<path d="M4 10v10h16V10"/><path d="M3 10l2-6h14l2 6"/><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M10 20v-5h4v5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  hand: '<path d="M7 11V6a1.5 1.5 0 0 1 3 0v4M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V11M16 11V8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L4.2 15a1.6 1.6 0 0 1 2.4-2L7 13.5V11"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15"/><path d="M20 20v-5h-5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  alert: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4M12 17h.01"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l5-5-5-5M15 12H3"/>',
  tv: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  ticket: '<path d="M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6z"/><path d="M14 6v2M14 11v2M14 16v2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  shirt: '<path d="M8 3 3 6l2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>',
  bottle: '<path d="M9.5 3h5v4h-5z"/><path d="M8 7h8l1 3v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V10z"/><path d="M7 13h10"/>',
  shoe: '<path d="M3 17V9h4.5l2 2.5 4-1 5.5 2.8a3 3 0 0 1 2 2.8V17z"/><path d="M3 20h18M10 14l1.5-1M13 14.5l1.5-1"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M6 5.5c3 3.2 3 9.8 0 13M18 5.5c-3 3.2-3 9.8 0 13"/>',
  sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3z"/><path d="M5 18v2M19 18v2"/>',
  gamepad: '<path d="M7 8h10a4 4 0 0 1 4 4v2a3 3 0 0 1-5.4 1.8L14.5 14h-5l-1.1 1.8A3 3 0 0 1 3 14v-2a4 4 0 0 1 4-4z"/><path d="M8 10.5v3M6.5 12h3M15.5 11.5h.01M17.5 13h.01"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5V5.5M20 18v3H6.5"/>',
  gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8S10.5 3 8 4s0 4 4 4zM12 8s1.5-5 4-4 0 4-4 4z"/>',
  baby: '<circle cx="12" cy="13" r="7"/><path d="M9.5 12h.01M14.5 12h.01M10 15.5a3 3 0 0 0 4 0M12 6a2 2 0 0 1 2-2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[name] || P.bag}</svg>`;
}

// ---------- Segmentos: cor + ícone ----------
const SEGMENTS = [
  { key: 'moda', q: 'jeans', label: 'Moda', icon: 'shirt', c: ['#c0266d', '#8a1650'] },
  { key: 'eletronicos', q: 'fone', label: 'Eletrônicos', icon: 'headphones', c: ['#2459d6', '#1b347f'] },
  { key: 'beleza', q: 'perfume', label: 'Beleza', icon: 'bottle', c: ['#b42ac6', '#7a1a88'] },
  { key: 'calcados', q: 'tênis', label: 'Calçados', icon: 'shoe', c: ['#d0501a', '#923211'] },
  { key: 'esportes', q: 'academia', label: 'Esportes', icon: 'ball', c: ['#1a8a45', '#11522b'] },
  { key: 'casa', q: 'casa', label: 'Casa', icon: 'sofa', c: ['#b07012', '#73440d'] },
  { key: 'games', q: 'jogo', label: 'Games', icon: 'gamepad', c: ['#6d35dd', '#43208f'] },
  { key: 'livros', q: 'livro', label: 'Livros', icon: 'book', c: ['#0f7f98', '#134c5e'] },
  { key: 'infantil', label: 'Infantil', icon: 'baby', c: ['#e0567a', '#a3304f'] },
  { key: 'presentes', label: 'Presentes', icon: 'gift', c: ['#c2344a', '#7f1d2d'] },
  { key: 'otica', label: 'Ótica', icon: 'eye', c: ['#3a6a8c', '#22405a'] },
];
const DEFAULT_SEG = { key: 'outros', label: 'Loja', icon: 'bag', c: ['#0f766e', '#073b38'] };

export const CHIP_SEGMENTS = SEGMENTS.slice(0, 8);

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export function segmentInfo(segment) {
  const n = norm(segment);
  if (!n) return DEFAULT_SEG;
  return (
    SEGMENTS.find((s) => n === s.key || n.startsWith(s.key.slice(0, 5)) || s.key.startsWith(n.slice(0, 5))) ||
    (n.includes('eletr') || n.includes('tecno') || n.includes('celular') ? SEGMENTS[1] : null) ||
    (n.includes('perfum') || n.includes('cosm') ? SEGMENTS[2] : null) ||
    (n.includes('esport') || n.includes('fitness') ? SEGMENTS[4] : null) ||
    (n.includes('decor') || n.includes('utilid') ? SEGMENTS[5] : null) ||
    (n.includes('livr') || n.includes('papel') ? SEGMENTS[7] : null) ||
    (n.includes('roupa') || n.includes('vestu') ? SEGMENTS[0] : null) ||
    DEFAULT_SEG
  );
}

export function segGradient(segment) {
  const s = segmentInfo(segment);
  return `background:linear-gradient(145deg, ${s.c[0]} 0%, ${s.c[1]} 100%)`;
}

export function segMedia(segment, cls, extra = '') {
  const s = segmentInfo(segment);
  return `<div class="${cls}" style="${segGradient(segment)}" aria-hidden="true">${extra}${icon(s.icon)}</div>`;
}

// ---------- Texto ----------
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function brl(v) {
  const n = Number(v);
  return Number.isFinite(n) ? brlFmt.format(n) : '—';
}

export function floorLabel(floor) {
  if (floor === undefined || floor === null || floor === '') return '';
  const f = String(floor).trim();
  if (/^piso|^t[ée]rreo|^subsolo|^l\d/i.test(f)) return f.charAt(0).toUpperCase() + f.slice(1);
  if (f === '0') return 'Térreo';
  return `Piso ${f}`;
}

function toDate(v) {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtTime(v) {
  const d = toDate(v);
  return d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
}

export function fmtDateTime(v) {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function relTime(v) {
  const d = toDate(v);
  if (!d) return '';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return d.toLocaleDateString('pt-BR');
}

export function stockLabel(stock) {
  const n = Number(stock);
  if (!Number.isFinite(n)) return { text: '', cls: '' };
  if (n <= 0) return { text: 'Sem estoque agora', cls: 'none' };
  if (n <= 2) return { text: `Últimas ${n} unid.`, cls: 'low' };
  return { text: `${n} em estoque`, cls: '' };
}

// ---------- Armazenamento (nunca quebra: modo privado, cota cheia etc.) ----------
const mem = new Map();
function safeStore(kind) {
  try {
    const s = window[kind];
    const k = '__ponte_test__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}
const LS = safeStore('localStorage');
const SS = safeStore('sessionStorage');

function makeStore(backend, prefix) {
  return {
    get(key, fallback = null) {
      try {
        const raw = backend ? backend.getItem(prefix + key) : mem.get(prefix + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        const raw = JSON.stringify(value);
        if (backend) backend.setItem(prefix + key, raw);
        else mem.set(prefix + key, raw);
      } catch {
        mem.set(prefix + key, JSON.stringify(value));
      }
    },
    remove(key) {
      try {
        if (backend) backend.removeItem(prefix + key);
      } catch {
        /* ignora */
      }
      mem.delete(prefix + key);
    },
  };
}

export const local = makeStore(LS, 'ponte.');
export const session = makeStore(SS, 'ponte.s.');

// ---------- Toasts ----------
let toastRoot = null;
export function clearToasts() {
  if (toastRoot) toastRoot.querySelectorAll('.toast:not(.error)').forEach((t) => t.remove());
}

export function toast(message, { type = 'info', trace = null, timeout = type === 'error' ? 6000 : 2600 } = {}) {
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.className = 'toasts';
    toastRoot.setAttribute('role', 'status');
    toastRoot.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRoot);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const ic = type === 'error' ? 'alert' : type === 'success' ? 'checkCircle' : 'bell';
  el.innerHTML = `${icon(ic)}<div class="msg">${esc(message)}${trace ? ` Código: <code>${esc(trace)}</code>` : ''}</div><button type="button" aria-label="Fechar aviso">${icon('x', 'icon-sm')}</button>`;
  const close = () => el.remove();
  el.querySelector('button').addEventListener('click', close);
  toastRoot.appendChild(el);
  while (toastRoot.children.length > 3) toastRoot.firstChild.remove();
  if (timeout) setTimeout(close, trace ? timeout + 3000 : timeout);
  return el;
}

/** Mostra o erro de forma amigável, sempre com o código de rastreio quando existir. */
export function showError(err, fallback = 'Algo deu errado.') {
  const status = err && err.status;
  let msg;
  if (err && (err.kind === 'timeout' || err.kind === 'network')) msg = err.message;
  else if (status >= 500 || !err || !err.message) msg = fallback.endsWith('.') ? fallback : `${fallback}.`;
  else msg = err.message;
  if (status >= 500 && !/errado/i.test(msg)) msg = `Algo deu errado. ${msg}`;
  toast(msg, { type: 'error', trace: err && err.traceId });
}

/** Coloca um botão em estado de carregamento enquanto a promessa roda. */
export async function withBusy(btn, fn, busyText) {
  if (!btn) return fn();
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${busyText ? `<span>${esc(busyText)}</span>` : ''}`;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.innerHTML = html;
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
