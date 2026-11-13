// Normalização de texto em português, tokens e extração de preços.

const STOPWORDS = new Set(`
a o as os um uma uns umas e ou de da do das dos d em no na nos nas num numa por pelo pela pelos pelas
para pra pro pras pros com sem que se ao aos à às eu meu minha meus minhas voce vc tu ele ela isso esse
essa este esta aquele aquela aqui ali la lá quero queria procuro procurando preciso gostaria tem tinha
vi ver achei encontrei comprar compra loja lojas shopping internet online site app mais menos muito
bem tipo igual parecido parecida algo alguma algum coisa favor obrigado ola oi bom boa dia tarde noite
ate abaixo acima maximo minimo reais real r$ rs valor preco custa custando
`.split(/\s+/).filter(Boolean));

// Expressões de mais de uma palavra viram um token só (antes de separar).
const PHRASES = [
  [/\bsem fios?\b/g, 'semfio'],
  [/\bcom fios?\b/g, 'comfio'],
  [/\bwireless\b/g, 'semfio'],
];

// Sinônimos: token -> forma canônica adicional (busca e catálogo usam o mesmo mapa).
const SYNONYMS = {
  headphone: 'fone', headphones: 'fone', headset: 'fone', earbud: 'fone', earbuds: 'fone', fones: 'fone',
  laptop: 'notebook', smartphone: 'celular', telefone: 'celular',
  relogio: 'smartwatch', smartband: 'smartwatch', running: 'corrida', sneaker: 'tenis',
  fragrancia: 'perfume', colonia: 'perfume', bike: 'bicicleta', game: 'jogo', videogame: 'console',
  chapinha: 'prancha', anc: 'cancelamento',
};

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Plural simples: "fones" -> "fone". Aplicado igual na busca e no catálogo.
export function stem(token) {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** Tokens normalizados, sem stopwords, com plural simplificado. */
export function tokenize(text) {
  let t = normalize(text);
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  return t
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w) && !(w.length === 1 && !/\d/.test(w)))
    .map(stem);
}

/** Token + sinônimo canônico (se houver). */
export function expand(token) {
  const syn = SYNONYMS[token] ?? SYNONYMS[token + 's'];
  return syn && syn !== token ? [token, stem(syn)] : [token];
}

/** Converte "1.599,90", "489,90", "500", "499.9" em número. */
export function parseNumber(raw) {
  let s = String(raw).trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const MAX_RE = new RegExp(
  String.raw`\b(?:ate|abaixo de|no maximo|menos de|max(?:imo)?|teto de|orcamento de)\s*(?:r\$|rs)?\s*(${NUM})(?:\s*(mil|reais))?`, 'g');
const PRICE_RE = new RegExp(String.raw`(?:r\$|rs)\s*(${NUM})|\b(?:por|custa|custando|a|de)\s+(${NUM})\s*(?:reais|real)\b|\b(${NUM})\s*reais\b`, 'g');

function toValue(numText, mil) {
  const n = parseNumber(numText);
  if (n == null) return null;
  return mil === 'mil' ? n * 1000 : n;
}

/**
 * Extrai preços de um texto livre.
 * - maxPrice: "até 500", "até R$ 500,00", "abaixo de 300"
 * - onlinePrice: "R$ 489,90", "por 489,90 reais" (preço visto em outro lugar)
 * Devolve também `rest`: o texto sem as expressões de preço (para gerar tokens).
 */
export function parsePrices(text) {
  let t = normalize(text);
  let maxPrice = null;
  let onlinePrice = null;
  t = t.replace(MAX_RE, (_, n, mil) => {
    const v = toValue(n, mil);
    if (v != null && v > 0 && maxPrice == null) maxPrice = v;
    return ' ';
  });
  t = t.replace(PRICE_RE, (_, a, b, c) => {
    const v = toValue(a ?? b ?? c);
    if (v != null && v > 0 && onlinePrice == null) onlinePrice = v;
    return ' ';
  });
  return { maxPrice, onlinePrice, rest: t.replace(/\s+/g, ' ').trim() };
}

/** Formata preço em reais: 489.9 -> "R$ 489,90". */
export function brl(value) {
  return 'R$ ' + Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
