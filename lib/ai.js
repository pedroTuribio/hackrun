// IA via REST do Gemini (generateContent). Sem dependências.
// As funções lançam erro em qualquer falha: quem chama (lib/search.js) cai para as regras.
import { config } from './config.js';
import { log } from './logger.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const FALLBACK_MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 12_000;
const CONFIDENCE = ['alta', 'media', 'baixa'];

async function callModel(model, parts, key, traceId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    });
    log('info', { traceId, msg: 'gemini', model, status: res.status, ms: Date.now() - started });
    if (!res.ok) {
      const err = new Error(`gemini respondeu ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new Error('gemini sem conteúdo');
    return parseJson(text);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('gemini: tempo esgotado');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('gemini devolveu JSON inválido');
  }
}

// Se o modelo configurado não existir (404), passa a usar o reserva nesta instância.
let modelMissing = false;

async function generate(parts, traceId) {
  const cfg = config();
  if (!cfg.geminiKey) throw new Error('IA desligada (sem GEMINI_API_KEY)');
  const model = modelMissing ? FALLBACK_MODEL : cfg.geminiModel;
  try {
    return await callModel(model, parts, cfg.geminiKey, traceId);
  } catch (err) {
    if (err.status === 404 && model !== FALLBACK_MODEL) {
      modelMissing = true;
      return callModel(FALLBACK_MODEL, parts, cfg.geminiKey, traceId);
    }
    throw err;
  }
}

const str = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const price = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.,]/g, '').replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
};

const INTERPRET_PROMPT = `Você ajuda clientes de um shopping a encontrar nas lojas físicas um produto que viram na internet.
Analise o texto e/ou a imagem (pode ser foto do produto ou print de uma página de loja online) e descreva SÓ o que dá para ver ou ler.
Não invente marca, modelo, cor ou preço: se não souber, use null.
Responda apenas com JSON neste formato:
{"name": "nome curto e genérico do produto em português (ex.: fone bluetooth com cancelamento de ruído)",
 "category": "categoria em português (ex.: Fones de ouvido, Tênis de corrida, Perfumes, Notebooks, Smartwatch, Mochilas)",
 "brand": "marca se aparecer claramente, senão null",
 "color": "cor principal em português, senão null",
 "keywords": ["até 8 palavras-chave em português, minúsculas, incluindo sinônimos e características"],
 "maxPrice": "preço máximo que a pessoa quer pagar, se ela disser (número), senão null",
 "onlinePrice": "preço que aparece no print ou que a pessoa diz ter visto online (número), senão null",
 "confidence": "alta | media | baixa (o quanto você tem certeza do que é o produto)"}`;

/**
 * Interpreta a busca (texto e/ou imagem).
 * -> { name, category, brand, color, keywords[], maxPrice, onlinePrice, confidence }
 */
export async function interpret({ query, image, traceId } = {}) {
  const parts = [{ text: INTERPRET_PROMPT }];
  if (query) parts.push({ text: `Texto da pessoa: """${String(query).slice(0, 300)}"""` });
  if (image?.data) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  const raw = await generate(parts, traceId);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('interpretação em formato inesperado');

  const keywords = Array.isArray(raw.keywords)
    ? [...new Set(raw.keywords.map((k) => str(k, 40).toLowerCase()).filter(Boolean))].slice(0, 10)
    : [];
  const out = {
    name: str(raw.name) || null,
    category: str(raw.category, 60) || null,
    brand: str(raw.brand, 40) || null,
    color: str(raw.color, 30) || null,
    keywords,
    maxPrice: price(raw.maxPrice),
    onlinePrice: price(raw.onlinePrice),
    confidence: CONFIDENCE.includes(raw.confidence) ? raw.confidence : 'media',
  };
  for (const k of ['brand', 'color', 'category']) if (out[k] && /^(null|n\/a|desconhecid[ao])$/i.test(out[k])) out[k] = null;
  if (!out.name && !out.keywords.length) throw new Error('IA não identificou o produto');
  return out;
}

const RANK_PROMPT = `Você compara o produto que a pessoa procura com produtos REAIS do catálogo do shopping.
Para CADA candidato, classifique:
- "igual": é o mesmo produto (mesma marca e modelo, ou idêntico em tudo que importa);
- "parecido": serve para a mesma necessidade (mesma função/categoria), mas muda marca, modelo, cor ou detalhe;
- "descartar": não atende ao que a pessoa procura.
Use SOMENTE os ids da lista de candidatos. Não invente produtos, preços nem estoque.
"reason": motivo curto em português, até 80 caracteres (ex.: "Mesma marca e modelo" ou "Também tem ANC, marca diferente").
Responda apenas com JSON: {"results": [{"id": "...", "match": "igual|parecido|descartar", "reason": "..."}]}`;

/**
 * Classifica candidatos do catálogo.
 * -> [{ id, match: 'igual'|'parecido'|'descartar', reason }]
 */
export async function rank({ interpreted, candidates, traceId } = {}) {
  const slim = candidates.map((p) => ({
    id: p.id, name: p.name, brand: p.brand, color: p.color, category: p.category, price: p.price, tags: p.tags,
  }));
  const want = {
    name: interpreted.name, category: interpreted.category, brand: interpreted.brand,
    color: interpreted.color, keywords: interpreted.keywords, maxPrice: interpreted.maxPrice,
  };
  const parts = [
    { text: RANK_PROMPT },
    { text: `Produto procurado: ${JSON.stringify(want)}` },
    { text: `Candidatos: ${JSON.stringify(slim)}` },
  ];
  const raw = await generate(parts, traceId);
  const list = Array.isArray(raw) ? raw : raw?.results;
  if (!Array.isArray(list)) throw new Error('classificação em formato inesperado');

  const ids = new Set(slim.map((c) => c.id));
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || !ids.has(item.id) || seen.has(item.id)) continue;
    const match = ['igual', 'parecido', 'descartar'].includes(item.match) ? item.match : null;
    if (!match) continue;
    seen.add(item.id);
    out.push({ id: item.id, match, reason: str(item.reason, 80) || (match === 'igual' ? 'Mesmo produto' : 'Produto parecido') });
  }
  if (!out.length) throw new Error('classificação vazia');
  return out;
}
