import { handler, HttpError } from '../lib/http.js';
import { route } from '../lib/route.js';

export default handler('route', {
  POST: async ({ body }) => {
    const ids = body?.productIds;
    if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Informe ao menos um produto para o roteiro.');
    if (ids.length > 20) throw new HttpError(400, 'O roteiro aceita até 20 produtos.');
    if (!ids.every((id) => typeof id === 'string' && id.length <= 60)) throw new HttpError(400, 'Lista de produtos inválida.');
    const result = await route(ids);
    if (!result.stops.length) throw new HttpError(404, 'Nenhum dos produtos foi encontrado.');
    return result;
  },
});
