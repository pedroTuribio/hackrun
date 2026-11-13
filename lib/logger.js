// Logs técnicos (console, JSON por linha) + eventos de negócio (banco).
// Nunca registre imagens, apelidos ou texto livre com dados pessoais aqui.

export function log(level, fields) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (process.env.PONTE_QUIET !== '1') console.log(line);
}

// Grava um evento de negócio sem nunca derrubar a requisição.
export async function event(type, traceId, data = {}) {
  try {
    const { db } = await import('./db.js');
    await db().addEvent({ type, trace_id: traceId, data });
  } catch (err) {
    log('error', { traceId, msg: 'falha ao gravar evento', type, error: err.message });
  }
}
