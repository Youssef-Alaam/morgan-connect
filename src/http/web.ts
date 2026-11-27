import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const DAY_SECONDS = 86_400;
const YEAR_SECONDS = 365 * DAY_SECONDS;
/** Prefixes the app owns: they are never answered with the page, so a wrong API path stays an error. */
const NOT_PAGES = ['/api', '/health'];

const ownedByApp = (path: string): boolean =>
  NOT_PAGES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

/** The file for a URL path inside `root`, or undefined when it is outside it or is not a file. */
async function fileFor(root: string, path: string): Promise<string | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  const full = normalize(join(root, decoded));
  if (full !== root && !full.startsWith(root + sep)) return undefined;
  const found = await stat(full).catch(() => undefined);
  return found?.isFile() === true ? full : undefined;
}

/** Cache policy: hashed build files never change, the page itself is always re-checked. */
function cacheFor(path: string): string {
  if (path.startsWith('/assets/')) return `public, max-age=${String(YEAR_SECONDS)}, immutable`;
  return path.endsWith('.html') ? 'no-cache' : `public, max-age=${String(DAY_SECONDS)}`;
}

/**
 * The built web app (`web/dist`): files as they are, and `index.html` for any other page path, so a
 * link like `/set-password` reaches the app. `/api` and `/health` are never answered here. Styles
 * may be inline because the app writes its design tokens into a style element.
 */
export function webRoutes(dir: string): Hono {
  const root = normalize(dir);
  const routes = new Hono();
  routes.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    }),
  );
  routes.get('*', async (c) => {
    const path = c.req.path;
    if (ownedByApp(path)) return c.json({ error: 'not_found' }, 404);
    const asset = await fileFor(root, path);
    // A missing file with an extension is a missing file; any other path is a page of the app.
    if (asset === undefined && extname(path) !== '') return c.text('Not found', 404);
    const file = asset ?? join(root, 'index.html');
    const body = await readFile(file);
    c.header('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    c.header('Cache-Control', asset === undefined ? 'no-cache' : cacheFor(path));
    return c.body(body);
  });
  return routes;
}
