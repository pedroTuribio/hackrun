// Servidor local que imita a Vercel: arquivos de public/ e funções de api/.
// Uso: node scripts/dev.js  (porta 3000, ou PORT=xxxx)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.statusCode = 400; // URL malformada (ex.: "/%E0") não pode derrubar o servidor
    return res.end('Endereço inválido');
  }
  let file = path.join(publicDir, decoded);
  if (!file.startsWith(publicDir)) { res.statusCode = 403; return res.end(); }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    if (existsSync(file + '.html')) file += '.html'; // cleanUrls
  }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Não encontrado');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/\/+$/, '');
    const file = path.join(root, 'api', `${name}.js`);
    if (!/^[a-z0-9-]+$/.test(name) || !existsSync(file)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: { message: 'Rota não encontrada.' } }));
    }
    req.query = Object.fromEntries(url.searchParams);
    const mod = await import(pathToFileURL(file).href);
    return mod.default(req, res);
  }
  return serveStatic(req, res, url.pathname);
});

server.listen(port, () => {
  console.log(`Ponte rodando em http://localhost:${port}`);
});

export default server;
