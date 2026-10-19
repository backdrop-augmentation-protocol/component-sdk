import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
createServer(async (req, res) => { try { const pathname = new URL(req.url, 'http://localhost').pathname; const fileName = pathname === '/' ? 'examples/minimal/index.html' : pathname.slice(1); const file = await readFile(join(root, fileName)); res.writeHead(200, { 'content-type': types[extname(fileName)] || 'text/plain' }); res.end(file); } catch { res.writeHead(404); res.end('Not found'); } }).listen(4173, () => console.log('Example: http://localhost:4173'));
