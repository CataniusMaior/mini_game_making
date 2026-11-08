// DRIFT ARK を配信する小さなウェブサーバー（依存パッケージなし）。
//
//   node server.mjs              http://localhost:9410/ で遊べる
//   node server.mjs 8080         ポートを変える
//
// 環境変数:
//   DRIFTARK_PORT  待ち受けるポート（既定 9410。引数があればそちらを優先）
//   DRIFTARK_HOST  待ち受けるアドレス（既定 127.0.0.1。Docker では 0.0.0.0）
//   DRIFTARK_ROOT  配信するフォルダ（既定はこのファイルのあるフォルダ）
//
// 配信するのはゲームに必要なファイル（index.html・css/・js/）だけで、
// README やテスト、.git などは返さない。
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.env.DRIFTARK_ROOT || path.dirname(fileURLToPath(import.meta.url)));
const PORT = parseInt(process.argv[2] || process.env.DRIFTARK_PORT || '9410', 10);
const HOST = process.env.DRIFTARK_HOST || '127.0.0.1';

// 配信してよいパス（ROOT からの相対パス）
const ALLOW_FILES = new Set(['index.html']);
const ALLOW_DIRS = ['css/', 'js/'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

const HEADERS = {
  // 再ビルドや更新のあと、古いファイルが残らないように毎回確かめさせる
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
};

function allowed(rel) {
  if (ALLOW_FILES.has(rel)) return true;
  return ALLOW_DIRS.some(d => rel.startsWith(d)) && !rel.split('/').some(part => part.startsWith('.'));
}

function send(res, status, text) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    send(res, 405, 'Method Not Allowed');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    send(res, 400, 'Bad Request');
    return;
  }
  if (pathname === '/healthz') { send(res, 200, 'ok'); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.resolve(ROOT, '.' + pathname);
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel.startsWith('..') || path.isAbsolute(rel) || !allowed(rel)) {
    send(res, 404, 'Not Found');
    return;
  }
  let info;
  try {
    info = await stat(file);
  } catch {
    info = null;
  }
  if (!info || !info.isFile()) {
    send(res, 404, 'Not Found');
    return;
  }
  res.writeHead(200, {
    ...HEADERS,
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Last-Modified': info.mtime.toUTCString()
  });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`ポート ${PORT} はほかのアプリが使っています。別のポートを指定してください（例: node server.mjs 9500）。`);
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const port = server.address().port;
  console.log(`DRIFT ARK: listening on ${HOST}:${port}`);
  if (process.env.DRIFTARK_IN_DOCKER) {
    console.log('ブラウザで http://localhost:9410/ を開いてください（compose.override.yaml でポートを変えたときは、その番号）。');
  } else {
    console.log(`ブラウザで http://localhost:${port}/ を開いてください。終わるときは Ctrl+C。`);
  }
});

// docker compose down / Ctrl+C で素直に終わる
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
