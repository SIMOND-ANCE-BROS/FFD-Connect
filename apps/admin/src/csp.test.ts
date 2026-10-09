import config from '../public/staticwebapp.config.json';

const API_ORIGINS = 'https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr';

/** Splits a CSP header into `{ directive: value }`, failing on a duplicate. */
function parseCsp(csp: string): Record<string, string> {
  const directives: Record<string, string> = {};
  for (const part of csp.split(';')) {
    const [name, ...rest] = part.trim().split(/\s+/);
    if (!name) continue;
    expect(directives).not.toHaveProperty(name);
    directives[name] = rest.join(' ');
  }
  return directives;
}

describe('Static Web App CSP', () => {
  const directives = parseCsp(config.globalHeaders['Content-Security-Policy']);

  it('pins every directive exactly, so a loosening or a dropped one fails', () => {
    expect(directives).toEqual({
      'default-src': "'self'",
      'script-src': "'self'",
      'style-src': "'self' 'unsafe-inline'",
      'img-src': `'self' data: ${API_ORIGINS}`,
      'font-src': "'self'",
      'connect-src': `'self' ${API_ORIGINS}`,
      'media-src': `'self' ${API_ORIGINS}`,
      'frame-ancestors': "'none'",
      'base-uri': "'self'",
      'form-action': "'self'",
    });
  });

  it('lets <img> load track artwork from both API origins', () => {
    expect(directives['img-src']).toBe(`'self' data: ${API_ORIGINS}`);
  });

  it('lets <audio> load track files from both API origins', () => {
    expect(directives['media-src']).toBe(`'self' ${API_ORIGINS}`);
  });

  it('keeps the API reachable for fetch', () => {
    expect(directives['connect-src']).toBe(`'self' ${API_ORIGINS}`);
  });

  it('forbids framing', () => {
    expect(directives['frame-ancestors']).toBe("'none'");
  });
});
