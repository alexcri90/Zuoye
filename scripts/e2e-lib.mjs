// Shared by the browser checks: serves dist/ from a sub-path and opens a phone-sized page.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

export const root = path.resolve(import.meta.dirname, '..');
export const out = path.join(root, 'e2e-out');
const dist = path.join(root, 'dist');
const PREFIX = '/sotto/cartella/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

export async function startSession() {
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const rel = url.pathname.startsWith(PREFIX) ? decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html' : null;
    const file = rel === null ? null : path.join(dist, rel);
    if (!file || !file.startsWith(dist) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true });

  const results = [];
  const problems = [];
  const requests = [];
  const failures = [];

  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  };

  async function newPage(options = {}) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      locale: 'it-IT',
      ...options,
    });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('request', (r) => requests.push(r.url()));
    page.on('requestfailed', (r) => failures.push(`${r.url()} (${r.failure()?.errorText ?? '?'})`));
    return { context, page };
  }

  const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
  const button = (page, name) => page.getByRole('button', { name, exact: true });

  async function finish() {
    await browser.close();
    server.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length === 0 ? 0 : 1);
  }

  return { base, browser, newPage, check, shot, button, problems, requests, failures, finish };
}
