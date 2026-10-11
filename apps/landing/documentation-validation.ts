import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** Validate generated documentation against the build, without network requests. */
export function validateDocumentation(root: string, base: string) {
  const docs = JSON.parse(readFileSync(resolve(root, 'documentation/manifest.json'), 'utf8')) as {
    slug: string;
  }[];
  const errors: string[] = [];
  const origin = 'https://build.local';
  const decode = (s: string) =>
    s
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  for (const page of [
    'documentation',
    'documentation/utilisateurs',
    'documentation/technique',
    ...docs.map((d) => 'documentation/' + d.slug),
  ]) {
    const html = readFileSync(resolve(root, page, 'index.html'), 'utf8');
    for (const match of html.matchAll(/<(?:a|img|link|script)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) {
      const href = decode(match[1]);
      if (!href || href === '#' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
      const url = new URL(href, origin + base + page + '/');
      if (!url.pathname.startsWith(base)) {
        errors.push(`${page}: link escapes deployment base: ${href}`);
        continue;
      }
      const path = decodeURIComponent(url.pathname.slice(base.length));
      let target = resolve(root, path);
      if (existsSync(target) && statSync(target).isDirectory())
        target = resolve(target, 'index.html');
      if (!existsSync(target)) {
        errors.push(`${page}: missing target: ${href}`);
      } else if (url.hash && path.startsWith('documentation/') && target.endsWith('.html')) {
        const fragment = decodeURIComponent(url.hash.slice(1));
        const ids = [...readFileSync(target, 'utf8').matchAll(/\bid="([^"]+)"/g)].map((m) =>
          decode(m[1]),
        );
        if (!ids.includes(fragment)) errors.push(`${page}: missing fragment: ${href}`);
      }
    }
  }
  if (errors.length) throw new Error('Broken documentation references:\n' + errors.join('\n'));
}
