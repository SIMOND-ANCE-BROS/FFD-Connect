import { correctionQuery, ensureOk } from './queries';

describe('ensureOk', () => {
  it('resolves on a 204', async () => {
    await expect(
      ensureOk(Promise.resolve({ response: new Response(null, { status: 204 }) })),
    ).resolves.toBeUndefined();
  });
  it('throws the parsed error body', async () => {
    const error = { message: 'refusé' };
    await expect(
      ensureOk(Promise.resolve({ error, response: new Response(null, { status: 400 }) })),
    ).rejects.toBe(error);
  });
  it('throws on a 4xx with an empty body', async () => {
    await expect(
      ensureOk(Promise.resolve({ response: new Response(null, { status: 403 }) })),
    ).rejects.toThrow('Requête refusée');
  });
  it('throws when there is no response', async () => {
    await expect(ensureOk(Promise.resolve({}))).rejects.toThrow('Requête refusée');
  });
});

describe('correctionQuery', () => {
  it('never wakes the scale-to-zero backend on a refocus, a reconnect or a retry', () => {
    expect(correctionQuery('c1')).toMatchObject({
      queryKey: ['admin', 'moderation', 'item', 'c1'],
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    });
  });
});
