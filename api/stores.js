import { handler } from '../lib/http.js';
import { db } from '../lib/db.js';
import { publicStore } from '../lib/auth.js';

export default handler('stores', {
  GET: async () => {
    const stores = (await db().listStores()).map(publicStore);
    stores.sort((a, b) => a.floor - b.floor || String(a.unit).localeCompare(String(b.unit), 'pt-BR', { numeric: true }));
    return { stores };
  },
});
