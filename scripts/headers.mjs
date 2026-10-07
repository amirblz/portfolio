#!/usr/bin/env node
/**
 * Writes dist/_headers after the build: security headers, a Content-Security-Policy that allows
 * only the inline scripts the build emitted (by hash) and the sites the IE windows frame, cache
 * lifetimes, and a CSS preload hint per page for Cloudflare's Early Hints.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = 'dist';

const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.html')) pages.push(path);
  }
})(DIST);

const scripts = new Set();
const frames = new Set();
const routes = [];
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/\ssrc=/.test(attrs)) scripts.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  for (const [, src] of html.matchAll(/<iframe[^>]*\ssrc="(https:[^"]+)"/g)) frames.add(new URL(src).origin);
  const css = [...html.matchAll(/<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)"/g)].map(([, href]) => href);
  const file = relative(DIST, page).split(sep).join('/');
  if (file === '404.html') continue;
  const route = `/${file.replace(/(^|\/)index\.html$/, '$1')}`;
  routes.push({ route, css });
}

const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...scripts].join(' ')}`,
  // Windows carry their size in style attributes.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `frame-src ${[...frames].sort().join(' ')}`,
  "form-action 'self' mailto:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const rules = [
  ['/*', {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  }],
  // Hashed file names: a new build is a new URL.
  ['/_astro/*', { 'Cache-Control': 'public, max-age=31536000, immutable' }],
  // The XP icons, sounds and wallpapers are not hashed, but they never change.
  ['/xp/*', { 'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400' }],
  ...routes
    .filter(({ css }) => css.length)
    .map(({ route, css }) => [route, { Link: css.map((href) => `<${href}>; rel=preload; as=style`).join(', ') }]),
];

const text = rules
  .map(([path, headers]) => [path, ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`)].join('\n'))
  .join('\n\n');
writeFileSync(join(DIST, '_headers'), `${text}\n`);
console.log(`_headers: ${scripts.size} script hashes, ${frames.size} framed sites, ${routes.length} pages`);
