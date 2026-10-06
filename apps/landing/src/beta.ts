// Beta install page (beta/index.html). The page is static and complete without
// JavaScript; this module only routes its CSS through Vite and puts the
// visitor's platform first.
import './index.css';
import './legal.css';
import './beta.css';

type Platform = 'ios' | 'android' | 'desktop';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  return 'desktop';
}

const platform = detectPlatform();
document.documentElement.dataset.platform = platform;

if (platform === 'desktop') {
  document.querySelector<HTMLElement>('[data-desktop-hint]')?.removeAttribute('hidden');
} else {
  document
    .querySelector<HTMLElement>(`.beta__card[data-platform="${platform}"] [data-badge]`)
    ?.removeAttribute('hidden');
}
