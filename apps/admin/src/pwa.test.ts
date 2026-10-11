import html from '../index.html?raw';
import config from '../public/staticwebapp.config.json';
import manifest from '../public/manifest.webmanifest?raw';
import { BRAND } from './theme';

// Every PNG of public/icons as a data URL, keyed by its public path.
const icons = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../public/icons/*.png', {
      query: '?inline',
      import: 'default',
      eager: true,
    }),
  ).map(([file, dataUrl]) => [file.replace('../public', ''), dataUrl]),
);
const app = JSON.parse(manifest) as {
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  scope: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; purpose: string }[];
};

/** Width x height of a public PNG, read from its IHDR chunk; null when missing. */
function pngSize(path: string): string | null {
  const dataUrl = icons[path];
  if (!dataUrl) return null;
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return `${view.getUint32(16)}x${view.getUint32(20)}`;
}

describe('installable back-office (#298)', () => {
  it('opens full screen on the whole site, under the FFD Admin name', () => {
    expect(app.name).toBe('FFD Connect — Admin');
    expect(app.short_name).toBe('FFD Admin');
    expect(app.display).toBe('standalone');
    expect(app.start_url).toBe('/');
    expect(app.scope).toBe('/');
    expect(app.theme_color).toBe(BRAND.blue);
  });

  it('ships 192/512 icons and a maskable one, each file at its declared size', () => {
    const sizes = app.icons.map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
    for (const icon of app.icons) {
      expect(pngSize(icon.src)).toBe(icon.sizes);
    }
  });

  it('links the manifest and the iOS home-screen metadata from index.html', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toMatch(/<link rel="apple-touch-icon" sizes="180x180" href="([^"]+)"/);
    expect(pngSize('/icons/apple-touch-icon.png')).toBe('180x180');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="FFD Admin"');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain(`name="theme-color" content="${BRAND.blue}"`);
  });

  it('serves the manifest with its MIME type, outside the SPA fallback', () => {
    expect(config.mimeTypes['.webmanifest']).toBe('application/manifest+json');
    expect(config.navigationFallback.exclude).toEqual(
      expect.arrayContaining(['/manifest.webmanifest', '/icons/*']),
    );
  });
});
