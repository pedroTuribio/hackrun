import { handler, HttpError } from '../lib/http.js';
import { search } from '../lib/search.js';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MIME = ['image/jpeg', 'image/png', 'image/webp'];

function validateImage(image) {
  if (image == null) return null;
  if (typeof image !== 'object') throw new HttpError(400, 'Imagem inválida.');
  let { mimeType, data } = image;
  if (typeof data !== 'string' || !data) throw new HttpError(400, 'Imagem inválida.');
  const m = data.match(/^data:([^;]+);base64,(.*)$/s); // aceita data URL também
  if (m) { mimeType = mimeType || m[1]; data = m[2]; }
  mimeType = String(mimeType ?? '').toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!MIME.includes(mimeType)) throw new HttpError(400, 'Formato de imagem não aceito. Use JPG, PNG ou WEBP.');
  data = data.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(400, 'Imagem inválida.');
  const bytes = Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) throw new HttpError(413, 'Imagem grande demais. O limite é 3 MB.');
  return { mimeType, data };
}

export default handler('search', {
  POST: async ({ body, traceId }) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Requisição inválida.');
    const query = typeof body.query === 'string' ? body.query.trim().slice(0, 300) : '';
    if (body.query != null && typeof body.query !== 'string') throw new HttpError(400, 'A busca precisa ser um texto.');
    const image = validateImage(body.image);
    if (!query && !image) throw new HttpError(400, 'Digite o que você procura ou envie uma foto.');
    return search({ query, image, traceId });
  },
});
