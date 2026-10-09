import config from '../public/staticwebapp.config.json';

describe('Static Web App CSP', () => {
  const csp = config.globalHeaders['Content-Security-Policy'];

  it('lets <audio> load track files from both API origins', () => {
    expect(csp).toContain(
      "media-src 'self' https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr",
    );
  });

  it('keeps the API reachable for fetch', () => {
    expect(csp).toContain(
      "connect-src 'self' https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr",
    );
  });
});
