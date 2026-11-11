import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Static data that lives in node_modules and must be served from our own origin
 * (so the page never has to talk to a third-party CDN).
 */
interface Mount {
  /** URL prefix, relative to the app base, without leading slash. */
  prefix: string;
  /** Absolute source directory. */
  dir: string;
  /** Maps a requested file name to a source file name, or null to refuse. */
  resolve: (requested: string) => string | null;
  /** Lists [publishedName, sourceName] pairs to copy at build time. */
  list: () => Array<[string, string]>;
  contentType: (name: string) => string;
}

const root = path.resolve(import.meta.dirname, '..');
const nm = (...p: string[]) => path.join(root, 'node_modules', ...p);

const HEX_JSON = /^[0-9a-f]{4,6}\.json$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function passthrough(prefix: string, dir: string, contentType: (n: string) => string): Mount {
  return {
    prefix,
    dir,
    resolve: (name) => (SAFE_NAME.test(name) ? name : null),
    list: () =>
      fs
        .readdirSync(dir)
        .filter((n) => SAFE_NAME.test(n) && fs.statSync(path.join(dir, n)).isFile())
        .map((n) => [n, n] as [string, string]),
    contentType,
  };
}

const mounts: Mount[] = [
  {
    // Stroke data, published as <codepoint-hex>.json so file names stay ASCII.
    prefix: 'hanzi',
    dir: nm('hanzi-writer-data'),
    resolve: (name) => {
      if (!HEX_JSON.test(name)) return null;
      const cp = Number.parseInt(name.slice(0, -5), 16);
      return `${String.fromCodePoint(cp)}.json`;
    },
    list: () =>
      fs
        .readdirSync(nm('hanzi-writer-data'))
        .filter((n) => n.endsWith('.json') && n !== 'package.json' && [...n.slice(0, -5)].length === 1)
        .map((n) => {
          const cp = n.codePointAt(0)!;
          return [`${cp.toString(16)}.json`, n] as [string, string];
        }),
    contentType: () => 'application/json',
  },
  passthrough('pdfjs/cmaps', nm('pdfjs-dist', 'cmaps'), () => 'application/octet-stream'),
  passthrough('pdfjs/standard_fonts', nm('pdfjs-dist', 'standard_fonts'), () => 'application/octet-stream'),
  passthrough('pdfjs/iccs', nm('pdfjs-dist', 'iccs'), () => 'application/octet-stream'),
  passthrough('pdfjs/wasm', nm('pdfjs-dist', 'wasm'), (n) =>
    n.endsWith('.wasm') ? 'application/wasm' : n.endsWith('.js') || n.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream',
  ),
];

/** Serves (dev) and copies (build) the vendored static data. */
export function vendoredData(): Plugin {
  let outDir = path.join(root, 'dist');
  return {
    name: 'zuoye:vendored-data',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        for (const m of mounts) {
          const head = `/${m.prefix}/`;
          if (!url.startsWith(head)) continue;
          const requested = url.slice(head.length);
          const source = m.resolve(requested);
          const file = source ? path.join(m.dir, source) : null;
          if (!file || path.dirname(file) !== m.dir || !fs.existsSync(file)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('Content-Type', m.contentType(requested));
          res.setHeader('Cache-Control', 'public, max-age=86400');
          fs.createReadStream(file).pipe(res);
          return;
        }
        next();
      });
    },
    closeBundle() {
      if (!fs.existsSync(outDir)) return;
      for (const m of mounts) {
        const target = path.join(outDir, m.prefix);
        fs.mkdirSync(target, { recursive: true });
        for (const [published, source] of m.list()) {
          fs.copyFileSync(path.join(m.dir, source), path.join(target, published));
        }
      }
      const licence = nm('hanzi-writer-data', 'ARPHICPL.TXT');
      if (fs.existsSync(licence)) fs.copyFileSync(licence, path.join(outDir, 'hanzi', 'ARPHICPL.TXT'));
    },
  };
}

/**
 * Content-Security-Policy for the production build.
 * Scripts only from our origin, network only to our origin and the Gemini API.
 * (Not applied in dev: the dev server needs inline scripts and websockets.)
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  // Stylesheets only from our origin; inline style attributes are allowed
  // because Hanzi Writer positions its drawing with them. No inline <style>.
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://generativelanguage.googleapis.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export function securityHeaders(): Plugin {
  return {
    name: 'zuoye:csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

/**
 * Minimal offline support: writes sw.js with the list of built app-shell files.
 * Stroke data and pdf.js assets are cached lazily at runtime by the worker.
 */
export function serviceWorker(): Plugin {
  let outDir = path.join(root, 'dist');
  return {
    name: 'zuoye:service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!fs.existsSync(outDir)) return;
      const shell: string[] = ['./'];
      const walk = (dir: string, rel: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const relPath = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            if (rel === '' && (entry.name === 'hanzi' || entry.name === 'pdfjs')) continue;
            walk(path.join(dir, entry.name), relPath);
          } else if (entry.name !== 'sw.js' && !entry.name.endsWith('.map')) {
            // The pdf.js bundle is only needed when importing a lesson: cache it lazily.
            if (/pdf[.-]/.test(entry.name)) continue;
            shell.push(`./${relPath}`);
          }
        }
      };
      walk(outDir, '');
      const version = createHash('sha256').update(shell.join('|')).digest('hex').slice(0, 12);
      const template = fs.readFileSync(path.join(root, 'build', 'sw.template.js'), 'utf8');
      const out = template
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace("'__SHELL__'", JSON.stringify(shell));
      fs.writeFileSync(path.join(outDir, 'sw.js'), out);
    },
  };
}
