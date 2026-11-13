import { handler, HttpError } from '../lib/http.js';
import { db } from '../lib/db.js';
import { productView, storeMap } from '../lib/views.js';

export default handler('product', {
  GET: async ({ query }) => {
    const id = String(query.id ?? '').trim();
    if (!id) throw new HttpError(400, 'Informe o produto (id).');
    const product = await db().getProduct(id);
    if (!product) throw new HttpError(404, 'Produto não encontrado.');
    const [stores, products] = await Promise.all([storeMap(db()), db().listProducts()]);
    const similar = products
      .filter((p) => p.id !== product.id && p.category === product.category && p.stock > 0)
      .sort((a, b) => Math.abs(a.price - product.price) - Math.abs(b.price - product.price))
      .slice(0, 4)
      .map((p) => productView(p, stores.get(p.store_id)));
    return { product: productView(product, stores.get(product.store_id)), similar };
  },
});
