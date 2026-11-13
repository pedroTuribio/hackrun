// Busca: interpreta o pedido (IA ou regras), encontra candidatos no catálogo,
// classifica em "igual"/"parecido" e monta o comparativo online × shopping.
// A IA nunca cria produto: todo resultado vem do catálogo.
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './http.js';
import { event, log } from './logger.js';
import * as ai from './ai.js';
import { compare } from './compare.js';
import { normalize, tokenize, expand, parsePrices } from './text.js';
import { productView } from './views.js';

const MAX_RESULTS = 6;
const MAX_CANDIDATES = 12;
const LOW_CONFIDENCE_WARNING = 'Confiança baixa: confira o produto na loja antes de ir.';
const IMAGE_NEEDS_TEXT = 'Não consegui analisar a foto agora. Escreva o nome do produto (ex.: "fone bluetooth") e busque de novo.';

const COLORS = ['preto', 'preta', 'branco', 'branca', 'azul', 'vermelho', 'vermelha', 'rosa', 'cinza', 'prata', 'dourado',
  'dourada', 'verde', 'amarelo', 'amarela', 'bege', 'marrom', 'caramelo', 'roxo', 'roxa', 'laranja', 'grafite'];
const COLOR_CANON = { preta: 'preto', branca: 'branco', vermelha: 'vermelho', dourada: 'dourado', amarela: 'amarelo', roxa: 'roxo' };
// Palavras que, sozinhas, não definem o produto (cor, gênero, tamanho...).
const WEAK = new Set([...COLORS, 'masculino', 'masculina', 'feminino', 'feminina', 'unissex', 'adulto', 'novo', 'nova',
  'original', 'barato', 'barata', 'bom', 'boa', 'melhor', 'top', 'grande', 'pequeno', 'pequena', 'modelo', 'marca',
  'produto', 'cor', 'tamanho', 'numero', 'kit'].map((w) => tokenize(w)[0] ?? w));

// Palavra(s)-chave -> categoria do catálogo. A primeira regra que casar vence.
const CATEGORY_RULES = [
  [['tenis', 'corrida'], 'Tênis de corrida'], [['tenis', 'caminhada'], 'Tênis de corrida'], [['tenis', 'running'], 'Tênis de corrida'],
  [['caixa', 'som'], 'Caixas de som'], [['soundbar'], 'Caixas de som'], [['speaker'], 'Caixas de som'],
  [['fone'], 'Fones de ouvido'], [['headphone'], 'Fones de ouvido'], [['headset'], 'Fones de ouvido'], [['earbud'], 'Fones de ouvido'],
  [['smartwatch'], 'Smartwatch'], [['relogio'], 'Smartwatch'], [['smartband'], 'Smartwatch'],
  [['notebook'], 'Notebooks'], [['laptop'], 'Notebooks'], [['celular'], 'Celulares'], [['smartphone'], 'Celulares'],
  [['tablet'], 'Tablets'], [['monitor'], 'Monitores'], [['roteador'], 'Redes'],
  [['carregador'], 'Carregadores e cabos'], [['power', 'bank'], 'Carregadores e cabos'],
  [['perfume'], 'Perfumes'], [['fragrancia'], 'Perfumes'], [['colonia'], 'Perfumes'],
  [['mochila'], 'Mochilas'], [['bolsa'], 'Bolsas'], [['camiseta'], 'Camisetas'], [['calca'], 'Calças'],
  [['vestido'], 'Vestidos'], [['jaqueta'], 'Jaquetas'], [['moletom'], 'Jaquetas'], [['bermuda'], 'Bermudas'],
  [['oculo'], 'Óculos'], [['sandalia'], 'Sandálias'], [['chinelo'], 'Sandálias'], [['bota'], 'Botas'], [['coturno'], 'Botas'],
  [['sapato'], 'Sapatos'], [['sapatilha'], 'Sapatos'], [['tenis'], 'Tênis casual'],
  [['batom'], 'Maquiagem'], [['maquiagem'], 'Maquiagem'], [['protetor', 'solar'], 'Cuidados com a pele'], [['hidratante'], 'Cuidados com a pele'],
  [['shampoo'], 'Cabelos'], [['secador'], 'Cabelos'], [['prancha'], 'Cabelos'],
  [['air', 'fryer'], 'Eletroportáteis'], [['fritadeira'], 'Eletroportáteis'], [['cafeteira'], 'Eletroportáteis'],
  [['liquidificador'], 'Eletroportáteis'], [['aspirador'], 'Eletroportáteis'], [['ventilador'], 'Eletroportáteis'],
  [['panela'], 'Cozinha'], [['lencol'], 'Cama e banho'], [['toalha'], 'Cama e banho'], [['luminaria'], 'Decoração'],
  [['console'], 'Consoles'], [['videogame'], 'Consoles'], [['bicicleta'], 'Bicicletas'], [['bike'], 'Bicicletas'],
  [['livro'], 'Livros'], [['caderno'], 'Papelaria'], [['agenda'], 'Papelaria'], [['caneta'], 'Papelaria'],
  [['brinquedo'], 'Brinquedos'], [['boneca'], 'Brinquedos'], [['pelucia'], 'Brinquedos'],
  [['patinete'], 'Patinetes'], [['geladeira'], 'Eletrodomésticos'], [['televisao'], 'TVs'], [['tv'], 'TVs'],
].map(([words, cat]) => [words.map((w) => tokenize(w)[0] ?? w), cat]);

const LEVELS = ['baixa', 'media', 'alta'];
const minLevel = (...ls) => LEVELS[Math.min(...ls.map((l) => LEVELS.indexOf(l)).filter((i) => i >= 0))];

// ---------- índice do catálogo (calculado uma vez por lista de produtos) ----------

const indexCache = new WeakMap();
const tokenSet = (text) => new Set(tokenize(text).flatMap(expand));
// Pares que se excluem: quem pede "sem fio" não quer "com fio".
const CONFLICTS = [['semfio', 'comfio'], ['comfio', 'semfio']];

function indexCatalog(products) {
  let idx = indexCache.get(products);
  if (idx) return idx;
  const df = new Map();
  for (const p of products) for (const t of new Set(tokenize(p.name))) df.set(t, (df.get(t) ?? 0) + 1);
  idx = products.map((p) => ({
    p,
    name: tokenSet(p.name),
    nameTokens: [...new Set(tokenize(p.name))].filter((t) => !WEAK.has(t)),
    brand: tokenSet(p.brand),
    brandNorm: normalize(p.brand),
    tags: tokenSet((p.tags ?? []).join(' ')),
    tagList: (p.tags ?? []).map((t) => ({ text: t, toks: tokenize(t) })).filter((t) => t.toks.length),
    category: tokenSet(p.category),
    categoryNorm: normalize(p.category),
    color: tokenSet(p.color),
    colorNorm: normalize(p.color),
    desc: tokenSet(p.description),
  }));
  // Tokens "de modelo": raros no catálogo e que não são só características (ex.: "pulse", "700", "q45").
  for (const e of idx) {
    e.modelTokens = e.nameTokens.filter((t) => (df.get(t) ?? 0) <= 2 && !e.tags.has(t) && !e.category.has(t) && !e.brand.has(t));
  }
  indexCache.set(products, idx);
  return idx;
}

// ---------- interpretação por regras ----------

export function guessCategory(tokens, categories = []) {
  // Posição de cada token (sinônimos herdam a posição): a palavra que aparece primeiro
  // costuma ser o produto ("mochila para notebook" -> Mochilas).
  const pos = new Map();
  tokens.forEach((t, i) => expand(t).forEach((a) => { if (!pos.has(a)) pos.set(a, i); }));
  let best = null;
  for (const [words, cat] of CATEGORY_RULES) {
    if (!words.every((w) => pos.has(w))) continue;
    const at = Math.min(...words.map((w) => pos.get(w)));
    if (!best || at < best.at) best = { at, cat };
  }
  if (best) return best.cat;
  // Tenta casar com o nome de uma categoria existente no catálogo.
  for (const c of categories) {
    const ct = tokenize(c);
    if (ct.length && ct.every((t) => pos.has(t))) return c;
  }
  return null;
}

function cleanName(query) {
  const words = String(query).trim().split(/\s+/);
  const isPrice = (w) => /^(r\$|rs|reais|real)$/i.test(w) || /^(r\$)?\d[\d.,]*(mil)?$/i.test(w) && /[.,]\d{2}$|^r\$/i.test(w);
  const keep = [];
  for (let i = 0; i < words.length; i++) {
    const n = normalize(words[i]);
    if (/^(r\$|rs)$/.test(n)) { i++; continue; } // "R$" e o número seguinte
    if (/^(ate|abaixo|maximo)$/.test(n) && /^(r\$|rs|\d)/.test(normalize(words[i + 1] ?? ''))) {
      i++;
      if (/^(r\$|rs)$/.test(normalize(words[i]))) i++;
      continue;
    }
    if (isPrice(words[i])) continue;
    keep.push(words[i]);
  }
  const stop = (w) => !tokenize(w).length;
  while (keep.length && stop(keep[0])) keep.shift();
  while (keep.length && stop(keep[keep.length - 1])) keep.pop();
  return keep.join(' ').replace(/[,;.!?]+$/, '').slice(0, 80) || null;
}

export function interpretByRules(query, products = [], categories = []) {
  const { maxPrice, onlinePrice, rest } = parsePrices(query);
  const tokens = [...new Set(tokenize(rest))];
  const set = new Set(tokens);
  let brand = null;
  for (const p of products) {
    const bt = tokenize(p.brand);
    if (bt.length && bt.every((t) => set.has(t))) { brand = p.brand; break; }
  }
  const colorTok = tokens.find((t) => COLORS.includes(t));
  const color = colorTok ? (COLOR_CANON[colorTok] ?? colorTok) : null;
  return {
    name: cleanName(query),
    category: guessCategory(tokens, categories),
    brand,
    color: color ? color[0].toUpperCase() + color.slice(1) : null,
    keywords: tokens,
    maxPrice,
    onlinePrice,
  };
}

// ---------- pontuação ----------

function buildTerms(texts) {
  const seen = new Set();
  const terms = [];
  for (const tok of texts.flatMap((t) => tokenize(t))) {
    if (seen.has(tok)) continue;
    seen.add(tok);
    terms.push({ tok, alts: expand(tok), weak: WEAK.has(tok) || /^\d+$/.test(tok) });
  }
  return terms;
}

const hit = (set, alts) => alts.some((a) => set.has(a));

function scoreProduct(entry, terms, ctx) {
  let raw = 0;
  let matched = 0;
  let strong = 0;
  for (const term of terms) {
    let w = 0;
    if (hit(entry.name, term.alts)) w = 3;
    else if (hit(entry.brand, term.alts)) w = 3;
    else if (hit(entry.tags, term.alts)) w = 2.5;
    else if (hit(entry.category, term.alts)) w = 2;
    else if (hit(entry.color, term.alts)) w = 1;
    else if (hit(entry.desc, term.alts)) w = 0.5;
    if (term.weak) w *= 0.5;
    if (w >= 0.5 && !(w === 0.5 && !term.weak)) {
      matched++;
      if (!term.weak) strong++;
    }
    raw += w;
  }
  let phrase = 0;
  for (const t of entry.tagList) {
    if (t.toks.length > 1 && ctx.queryJoined.includes(` ${t.toks.join(' ')} `)) phrase += 1.5;
  }
  raw += Math.min(phrase, 3);
  const catMatch = !!ctx.categoryNorm && entry.categoryNorm === ctx.categoryNorm;
  const brandMatch = !!ctx.brandNorm && entry.brandNorm === ctx.brandNorm;
  const colorMatch = !!ctx.colorNorm && entry.colorNorm === ctx.colorNorm;
  if (catMatch) raw += 3;
  if (brandMatch) raw += 2;
  if (colorMatch) raw += 0.5;
  const maxRaw = terms.reduce((s, t) => s + (t.weak ? 1.5 : 3), 0) + (ctx.categoryNorm ? 3 : 0) + (ctx.brandNorm ? 2 : 0) + 1.5;
  const coverage = terms.length ? matched / terms.length : 0;
  return { score: Math.min(1, raw / maxRaw), coverage, strong, catMatch, brandMatch, colorMatch };
}

function retrieve(products, interpreted, terms, { loose }) {
  const idx = indexCatalog(products);
  const ctx = {
    queryJoined: ` ${terms.map((t) => t.tok).join(' ')} `,
    tokens: new Set(terms.map((t) => t.tok)),
    categoryNorm: interpreted.category ? normalize(interpreted.category) : null,
    brandNorm: interpreted.brand ? normalize(interpreted.brand) : null,
    colorNorm: interpreted.color ? normalize(interpreted.color) : null,
  };
  const out = [];
  for (const entry of idx) {
    const p = entry.p;
    if (!(p.stock > 0)) continue;
    if (interpreted.maxPrice && p.price > interpreted.maxPrice) continue;
    if (CONFLICTS.some(([want, avoid]) => ctx.tokens.has(want) && entry.tags.has(avoid) && !entry.tags.has(want))) continue;
    const s = scoreProduct(entry, terms, ctx);
    if (!s.strong && !s.catMatch) continue;
    const ok = loose
      ? s.catMatch || s.coverage >= 0.34
      : s.catMatch
        ? s.coverage >= 0.5 || s.strong >= 2 || terms.length <= 1
        : s.coverage >= (ctx.categoryNorm ? 0.75 : 0.5) && s.score >= 0.4;
    if (!ok) continue;
    out.push({ entry, ...s });
  }
  out.sort((a, b) => b.score - a.score || a.entry.p.price - b.entry.p.price);
  return { candidates: out.slice(0, MAX_CANDIDATES), ctx };
}

// ---------- classificação por regras ----------

function matchedFeatures(entry, terms) {
  const qAlts = new Set(terms.flatMap((t) => t.alts));
  const catToks = new Set(tokenize(entry.p.category).flatMap(expand));
  const picked = [];
  const covered = new Set();
  const tags = [...entry.tagList].sort((a, b) => b.toks.length - a.toks.length);
  for (const t of tags) {
    const alts = t.toks.flatMap(expand);
    if (!t.toks.every((tok) => expand(tok).some((a) => qAlts.has(a)))) continue;
    if (alts.some((a) => catToks.has(a))) continue;
    if (t.toks.every((tok) => WEAK.has(tok))) continue;
    if (t.toks.every((tok) => expand(tok).some((a) => covered.has(a)))) continue;
    alts.forEach((a) => covered.add(a));
    picked.push(t.text);
    if (picked.length === 2) break;
  }
  return picked;
}

function classifyByRules(c, interpreted, terms) {
  const { entry } = c;
  const p = entry.p;
  const qAlts = new Set(terms.flatMap((t) => t.alts));
  const nameCov = entry.nameTokens.length
    ? entry.nameTokens.filter((t) => expand(t).some((a) => qAlts.has(a))).length / entry.nameTokens.length
    : 0;
  // "igual" só com evidência específica: mesma marca, ou o modelo citado na busca.
  const modelHit = entry.modelTokens.some((t) => qAlts.has(t));
  const igual = (interpreted.brand && c.brandMatch && c.catMatch && c.coverage >= 0.6 && (modelHit || nameCov >= 0.8))
    || (modelHit && nameCov >= 0.6 && c.coverage >= 0.6);

  if (igual) {
    const reason = c.brandMatch
      ? (nameCov >= 0.6 ? `Mesma marca (${p.brand}) e mesmo modelo` : `Mesma marca (${p.brand}) e mesmas características`)
      : 'Nome e características iguais aos da busca';
    return { match: 'igual', reason: reason.slice(0, 80) };
  }
  const parts = [c.catMatch ? 'Mesma categoria' : interpreted.category ? 'Outra categoria' : 'Combina com a busca'];
  if (interpreted.brand) parts.push(c.brandMatch ? 'mesma marca' : 'marca diferente');
  if (interpreted.color) parts.push(c.colorMatch ? 'mesma cor' : 'outra cor');
  let reason = parts.join(', ');
  const feats = matchedFeatures(entry, terms);
  if (feats.length) {
    const withFeat = `${reason}; tem ${feats.join(' e ')}`;
    reason = withFeat.length <= 80 ? withFeat : `${reason}; tem ${feats[0]}`;
  }
  return { match: 'parecido', reason: reason.slice(0, 80) };
}

/**
 * Quando as regras acham o produto "igual", também procura parecidos dele mesmo
 * (mesma categoria e características, outra marca): é assim que aparece a opção mais barata em outra loja.
 */
function similarToIgual(products, results, interpreted) {
  const ref = results.find((r) => r.match === 'igual')?.c;
  if (!ref) return [];
  const p = ref.entry.p;
  const refInterp = { category: p.category, brand: p.brand, color: p.color, maxPrice: interpreted.maxPrice };
  const refTerms = buildTerms([(p.tags ?? []).join(' ')]);
  const have = new Set(results.map((r) => r.c.entry.p.id));
  return retrieve(products, { ...refInterp, brand: null }, refTerms, { loose: false }).candidates
    .filter((c) => !have.has(c.entry.p.id) && c.score >= 0.6)
    .slice(0, 3)
    .map((c) => {
      const scored = { ...c, score: c.score * ref.score * 0.85, brandMatch: c.entry.brandNorm === normalize(p.brand), colorMatch: c.entry.colorNorm === normalize(p.color) };
      const { reason } = classifyByRules({ ...scored, coverage: 0 }, refInterp, refTerms);
      return { c: scored, match: 'parecido', reason };
    });
}

// ---------- confiança ----------

function scoreLevel(score) {
  return score >= 0.6 ? 'alta' : score >= 0.35 ? 'media' : 'baixa';
}

function confidenceFor(results, aiConfidence) {
  if (!results.length) return aiConfidence ?? 'baixa';
  const top = results[0];
  let level = scoreLevel(top.score);
  if (!results.some((r) => r.match === 'igual')) level = minLevel(level, 'media');
  // Muitos resultados quase empatados e fracos: ninguém se destaca.
  if (results.length >= 3 && top.score < 0.5 && top.score - results[results.length - 1].score < 0.05) {
    level = LEVELS[Math.max(0, LEVELS.indexOf(level) - 1)];
  }
  return aiConfidence ? minLevel(level, aiConfidence) : level;
}

// ---------- fluxo principal ----------

function mapCategory(cat, categories, tokens) {
  if (!cat) return guessCategory(tokens, categories);
  const n = normalize(cat);
  const exact = categories.find((c) => normalize(c) === n);
  if (exact) return exact;
  const byRule = guessCategory([...tokenize(cat), ...tokens], categories);
  return byRule ?? cat;
}

/**
 * search({ query, image, traceId }) -> resposta de /api/search (sem traceId).
 * Lança HttpError(400) quando só há foto e a IA não está disponível.
 */
export async function search({ query = '', image = null, traceId = null } = {}) {
  const cfg = config();
  const text = String(query ?? '').trim();
  const hasImage = !!image?.data;
  const useAi = cfg.aiMode === 'gemini';
  const products = await db().listProducts();
  const categories = [...new Set(products.map((p) => p.category))];
  const rules = text ? interpretByRules(text, products, categories) : null;

  // a) interpretação
  let interpreted = null;
  let source = 'regras';
  let aiConfidence = null;
  if (useAi) {
    try {
      const got = await ai.interpret({ query: text, image: hasImage ? image : null, traceId });
      const tokens = tokenize([got.name, ...got.keywords].join(' '));
      interpreted = {
        name: got.name ?? rules?.name ?? null,
        category: mapCategory(got.category, categories, tokens) ?? rules?.category ?? null,
        brand: got.brand ?? rules?.brand ?? null,
        color: got.color ?? rules?.color ?? null,
        keywords: got.keywords.length ? got.keywords : rules?.keywords ?? [],
        maxPrice: rules?.maxPrice ?? got.maxPrice,
        onlinePrice: rules?.onlinePrice ?? got.onlinePrice,
      };
      aiConfidence = got.confidence;
      source = 'ia';
    } catch (err) {
      log('warn', { traceId, msg: 'IA falhou na interpretação; usando regras', error: err.message });
      await event('erro_ia', traceId, { stage: 'interpret', message: String(err.message).slice(0, 120) });
    }
  }
  if (!interpreted) {
    if (!rules) throw new HttpError(400, IMAGE_NEEDS_TEXT);
    interpreted = rules;
  }

  // b) candidatos
  const terms = buildTerms(source === 'ia'
    ? [rules ? parsePrices(text).rest : '', interpreted.name ?? '', ...(interpreted.keywords ?? []), interpreted.brand ?? '']
    : [parsePrices(text).rest]);
  const { candidates } = retrieve(products, interpreted, terms, { loose: source === 'ia' });

  // c) classificação
  let results = [];
  let ranked = null;
  if (source === 'ia' && candidates.length) {
    try {
      ranked = await ai.rank({ interpreted, candidates: candidates.map((c) => c.entry.p), traceId });
    } catch (err) {
      log('warn', { traceId, msg: 'IA falhou na classificação; usando regras', error: err.message });
      await event('erro_ia', traceId, { stage: 'rank', message: String(err.message).slice(0, 120) });
    }
  }
  if (ranked) {
    const byId = new Map(candidates.map((c) => [c.entry.p.id, c]));
    results = ranked
      .filter((r) => r.match !== 'descartar')
      .map((r) => ({ c: byId.get(r.id), match: r.match, reason: r.reason }));
  } else {
    // Sem IA na classificação, a busca solta (feita para a IA) fica estrita de novo.
    const strict = source === 'ia' ? retrieve(products, interpreted, terms, { loose: false }).candidates : candidates;
    // Corta a "cauda" fraca: só mostra o que chega perto do melhor candidato.
    const best = strict[0]?.score ?? 0;
    results = strict.filter((c) => c.score >= best * 0.5).map((c) => ({ c, ...classifyByRules(c, interpreted, terms) }));
    results = [...results, ...similarToIgual(products, results, interpreted)];
  }

  const storeById = new Map((await db().listStores()).map((s) => [s.id, s]));
  results = results
    .filter((r) => r.c)
    .sort((a, b) => (a.match === 'igual' ? 0 : 1) - (b.match === 'igual' ? 0 : 1)
      || b.c.score - a.c.score || a.c.entry.p.price - b.c.entry.p.price)
    .slice(0, MAX_RESULTS)
    .map((r) => ({
      product: productView(r.c.entry.p, storeById.get(r.c.entry.p.store_id)),
      match: r.match,
      reason: r.reason,
      score: Math.round(r.c.score * 100) / 100,
    }));

  // d) confiança
  const confidence = confidenceFor(results, aiConfidence);
  const warning = results.length && confidence === 'baixa' ? LOW_CONFIDENCE_WARNING : null;

  // e) comparativo
  let comparison = null;
  if (interpreted.onlinePrice && results.length) {
    // Compara com o mesmo produto quando existe; senão, só com os parecidos mais próximos (não com qualquer um).
    const iguais = results.filter((r) => r.match === 'igual');
    const topScore = Math.max(...results.map((r) => r.score));
    const pool = iguais.length ? iguais : results.filter((r) => r.score >= topScore - 0.1);
    const shoppingPrice = Math.min(...pool.map((r) => r.product.price));
    // Quando o "igual" sai mais caro, mostra (com honestidade) um parecido mais barato, se houver.
    const cheaper = iguais.length
      ? results.filter((r) => r.match === 'parecido' && r.score >= 0.7 && r.product.price < shoppingPrice)
        .sort((a, b) => a.product.price - b.product.price)[0]
      : null;
    comparison = compare({
      onlinePrice: interpreted.onlinePrice,
      shoppingPrice,
      basis: iguais.length ? 'igual' : 'parecido',
      alternative: cheaper ? { productId: cheaper.product.id, name: cheaper.product.name, price: cheaper.product.price, storeName: cheaper.product.store?.name ?? '' } : null,
    });
  }

  // f) eventos (sem imagem, sem dados pessoais)
  const term = normalize(interpreted.name ?? text).slice(0, 80);
  await event('busca_realizada', traceId, {
    query: normalize(text).slice(0, 80), term, hasImage, category: interpreted.category ?? null, results: results.length, source,
  });
  if (!results.length) await event('busca_sem_resultado', traceId, { term, category: interpreted.category ?? null });

  return {
    source,
    interpreted: {
      name: interpreted.name ?? null,
      category: interpreted.category ?? null,
      brand: interpreted.brand ?? null,
      color: interpreted.color ?? null,
      keywords: interpreted.keywords ?? [],
      maxPrice: interpreted.maxPrice ?? null,
      onlinePrice: interpreted.onlinePrice ?? null,
    },
    confidence,
    warning,
    results,
    comparison,
    notFound: results.length === 0,
  };
}
