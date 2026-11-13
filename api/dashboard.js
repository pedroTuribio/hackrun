import { handler } from '../lib/http.js';
import { db } from '../lib/db.js';
import { requireAdmin } from '../lib/auth.js';
import { dashboard } from '../lib/dashboard.js';

export default handler('dashboard', {
  GET: async ({ headers }) => {
    requireAdmin(headers);
    return dashboard(db());
  },
});
