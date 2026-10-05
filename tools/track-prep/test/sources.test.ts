import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyUrl, normalizeSourceKey } from '../src/sources.js';

test('classifyUrl — titres YouTube', () => {
  assert.deepEqual(classifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), {
    type: 'youtube-video',
    id: 'dQw4w9WgXcQ',
  });
  assert.deepEqual(classifyUrl('https://youtu.be/dQw4w9WgXcQ'), {
    type: 'youtube-video',
    id: 'dQw4w9WgXcQ',
  });
  assert.deepEqual(classifyUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), {
    type: 'youtube-video',
    id: 'dQw4w9WgXcQ',
  });
  // Lien watch avec paramètre list : traité comme un titre seul (noPlaylist).
  assert.deepEqual(classifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123'), {
    type: 'youtube-video',
    id: 'dQw4w9WgXcQ',
  });
});

test('classifyUrl — playlists YouTube', () => {
  assert.deepEqual(classifyUrl('https://www.youtube.com/playlist?list=PLabc_-123'), {
    type: 'youtube-playlist',
    id: 'PLabc_-123',
  });
  assert.deepEqual(classifyUrl('https://music.youtube.com/playlist?list=PLxyz'), {
    type: 'youtube-playlist',
    id: 'PLxyz',
  });
});

test('classifyUrl — Spotify (avec préfixe régional /intl-fr/)', () => {
  assert.deepEqual(classifyUrl('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'), {
    type: 'spotify-track',
    id: '4uLU6hMCjMI75M1A2tKUQC',
  });
  assert.deepEqual(
    classifyUrl('https://open.spotify.com/intl-fr/track/4uLU6hMCjMI75M1A2tKUQC?si=x'),
    { type: 'spotify-track', id: '4uLU6hMCjMI75M1A2tKUQC' },
  );
  assert.deepEqual(classifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), {
    type: 'spotify-collection',
    kind: 'playlist',
    id: '37i9dQZF1DXcBWIGoYBM5M',
  });
  assert.deepEqual(classifyUrl('https://open.spotify.com/album/6dVIqQ8qmQ5GBnJ9shOYGE'), {
    type: 'spotify-collection',
    kind: 'album',
    id: '6dVIqQ8qmQ5GBnJ9shOYGE',
  });
});

test('classifyUrl — lien non géré', () => {
  assert.deepEqual(classifyUrl('https://example.com/song'), {
    type: 'unsupported',
  });
});

test('normalizeSourceKey — même format que le backend', () => {
  assert.equal(
    normalizeSourceKey('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'youtube:dQw4w9WgXcQ',
  );
  assert.equal(
    normalizeSourceKey('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'),
    'spotify:4uLU6hMCjMI75M1A2tKUQC',
  );
  assert.equal(normalizeSourceKey('https://example.com/x'), null);
});
