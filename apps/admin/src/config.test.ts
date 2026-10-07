import { apiOrigin } from './config';

describe('apiOrigin', () => {
  it('strips the /api/v1 prefix (health lives outside it)', () => {
    expect(apiOrigin('https://api.example.fr/api/v1')).toBe('https://api.example.fr');
  });

  it('tolerates a trailing slash', () => {
    expect(apiOrigin('http://localhost:3000/api/v1/')).toBe('http://localhost:3000');
  });

  it('leaves a URL without the prefix unchanged', () => {
    expect(apiOrigin('https://api.example.fr')).toBe('https://api.example.fr');
  });
});
