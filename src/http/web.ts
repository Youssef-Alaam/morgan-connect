import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
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

const inside = (root: string, path: string): boolean =>
  path === root || path.startsWith(root + sep);

/** The file for a URL path inside `root`, or undefined when it is outside it (even through a link) or is not a file. */
async function fileFor(root: string, real: string, path: string): Promise<string | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  const full = normalize(join(root, decoded));
  if (!inside(root, full)) return undefined;
  const target = await realpath(full).catch(() => undefined);
  if (target === undefined || !inside(real, target)) return undefined;
  const found = await stat(target).catch(() => undefined);
  return found?.isFile() === true ? target : undefined;
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
  const root = resolve(dir);
  // Where the folder really is, so a link inside it cannot lead out.
  const real = realpath(root).catch(() => root);
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
    const asset = await fileFor(root, await real, path);
    // A missing file with an extension is a missing file; any other path is a page of the app.
    if (asset === undefined && extname(path) !== '') return c.text('Not found', 404);
    const file = asset ?? join(root, 'index.html');
    const body = await readFile(file).catch(() => undefined);
    if (body === undefined)
      return c.text('The web app is not built here: index.html is missing.', 500);
    c.header('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    c.header('Cache-Control', asset === undefined ? 'no-cache' : cacheFor(path));
    return c.body(body);
  });
  return routes;
}
