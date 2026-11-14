// Laterais do app no computador (telas largas): apresentação + QR "abra no celular".
// No celular as laterais ficam escondidas pelo CSS e nada disso aparece.
import { qrSVG } from './qr.js';

/** Endereço que o QR abre: a página inicial do cliente no mesmo site. */
export function appUrl(loc) {
  const origin = loc && loc.origin && loc.origin !== 'null' ? loc.origin : 'https://ponte-orcin.vercel.app';
  return `${origin}/`;
}

/** Texto curto do endereço, sem "https://" e sem a barra final. */
export function shortUrl(url) {
  return String(url).replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function mountDesk(doc = globalThis.document, loc = globalThis.location) {
  if (!doc) return;
  const box = doc.getElementById('desk-qr');
  const label = doc.getElementById('desk-url');
  if (!box) return;
  const url = appUrl(loc);
  try {
    box.innerHTML = qrSVG(url, { label: 'QR Code para abrir a Ponte no celular' });
  } catch {
    box.hidden = true;
  }
  if (label) label.textContent = shortUrl(url);
}

if (globalThis.document) mountDesk();
