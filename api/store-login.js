import { handler, HttpError } from '../lib/http.js';
import { db } from '../lib/db.js';
import { publicStore } from '../lib/auth.js';

export default handler('store-login', {
  POST: async ({ body }) => {
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!code) throw new HttpError(400, 'Informe o código da loja.');
    const store = await db().getStoreByCode(code);
    if (!store) throw new HttpError(401, 'Código da loja inválido.');
    return { store: publicStore(store) };
  },
});
