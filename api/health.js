import { handler } from '../lib/http.js';
import { config } from '../lib/config.js';

export default handler('health', {
  GET: async () => {
    const cfg = config();
    return { ok: true, mode: { data: cfg.dataMode, ai: cfg.aiMode } };
  },
});
