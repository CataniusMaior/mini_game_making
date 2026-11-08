'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

// server.mjs を空いているポートで起動し、そのアドレスを返す
function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), '0'], {
      env: { ...process.env, DRIFTARK_HOST: '127.0.0.1', DRIFTARK_IN_DOCKER: '' }
    });
    let out = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('server did not start: ' + out)); }, 5000);
    proc.stdout.on('data', d => {
      out += d;
      const m = /listening on 127\.0\.0\.1:(\d+)/.exec(out);
      if (m) { clearTimeout(timer); resolve({ proc, base: 'http://127.0.0.1:' + m[1] }); }
    });
    proc.on('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + ': ' + out)); });
  });
}

// fetch は URL の ../ を正規化してしまうので、生のパスで送る
function rawGet(base, rawPath, method = 'GET') {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: rawPath, method }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('サーバー：ゲームのファイルだけを正しい種類で返す', async (t) => {
  const { proc, base } = await startServer();
  t.after(() => proc.kill());

  const ok = [
    ['/', 'text/html'],
    ['/index.html', 'text/html'],
    ['/css/style.css', 'text/css'],
    ['/js/game.js', 'text/javascript'],
    ['/healthz', 'text/plain']
  ];
  for (const [p, type] of ok) {
    const r = await rawGet(base, p);
    assert.equal(r.status, 200, p);
    assert.ok(r.type.startsWith(type), p + ' -> ' + r.type);
  }
  const index = await rawGet(base, '/');
  assert.match(index.body, /DRIFT ARK/);

  for (const p of ['/README.md', '/package.json', '/server.mjs', '/tests/game.test.js', '/.git/config',
    '/../package.json', '/js/../package.json', '/js/%2e%2e/package.json', '/css/missing.css']) {
    const r = await rawGet(base, p);
    assert.equal(r.status, 404, p);
  }
  assert.equal((await rawGet(base, '/', 'POST')).status, 405);
  assert.equal((await rawGet(base, '/', 'HEAD')).status, 200);
});
