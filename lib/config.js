const env = (name, fallback = '') => (process.env[name] ?? '').trim() || fallback;

export function config() {
  const supabaseUrl = env('SUPABASE_URL').replace(/\/+$/, '');
  const supabaseKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const forceMemory = env('DATA_MODE') === 'memory';
  const geminiKey = env('GEMINI_API_KEY');
  return {
    dataMode: !forceMemory && supabaseUrl && supabaseKey ? 'supabase' : 'memory',
    supabaseUrl,
    supabaseKey,
    aiMode: geminiKey ? 'gemini' : 'regras',
    geminiKey,
    geminiModel: env('GEMINI_MODEL', 'gemini-3.5-flash-lite'),
    adminCode: env('ADMIN_CODE', 'SHOP2026'),
  };
}
