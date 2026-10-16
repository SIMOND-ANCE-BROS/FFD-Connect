// Parental consent page (consentement-parental/index.html, #61). The backend
// e-mails a minor's legal representative a link
// ${FRONTEND_URL}/consentement-parental/?token=...; the same link confirms the
// consent, then withdraws it at any time.
import './index.css';
import './legal.css';
import './reset-password.css';
import './parental-consent.css';
import {
  apiUrl,
  describeOutcome,
  MISSING_TOKEN,
  type ApiOutcome,
  type ConsentAction,
  type PageView,
} from './parental-consent-logic';
import { readToken } from './reset-password-logic';

// The beta runs on backend-staging; backend-prod is stopped (see deploy-landing.yml).
const API_BASE = import.meta.env.VITE_API_URL ?? 'https://api-staging.ffd.gabin-simond.fr/api/v1';
// The backend scales to zero: a cold start can take up to ~2 minutes.
const TIMEOUT_MS = 150_000;

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

const title = must<HTMLHeadingElement>('[data-title]');
const status = must<HTMLParagraphElement>('[data-status]');
const messages = must<HTMLDivElement>('[data-messages]');
const lines = must<HTMLDivElement>('[data-lines]');
const confirmForm = must<HTMLFormElement>('[data-confirm-form]');
const confirmButton = must<HTMLButtonElement>('[data-confirm]');
const acceptData = must<HTMLInputElement>('[data-accept-data]');
const acceptHealth = must<HTMLInputElement>('[data-accept-health]');
const revokeBox = must<HTMLParagraphElement>('[data-revoke-box]');
const revokeButton = must<HTMLButtonElement>('[data-revoke]');

let busy = false;

function paragraphs(texts: string[]): HTMLParagraphElement[] {
  return texts.map((text) => {
    const p = document.createElement('p');
    p.textContent = text;
    return p;
  });
}

function showError(texts: string[]): void {
  messages.replaceChildren(...paragraphs(texts));
  messages.dataset.kind = 'error';
  messages.hidden = false;
}

function render(view: PageView): void {
  title.textContent = view.title;
  if (view.panel === 'error') {
    lines.replaceChildren();
    showError(view.lines);
  } else {
    messages.hidden = true;
    lines.replaceChildren(...paragraphs(view.lines));
  }
  confirmForm.hidden = !view.canConfirm;
  revokeBox.hidden = !view.canRevoke;
  revokeButton.textContent =
    view.panel === 'granted' ? 'Retirer mon accord' : 'Je refuse cette demande';
}

async function call(action: ConsentAction, body: Record<string, unknown>): Promise<ApiOutcome> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(API_BASE, action), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      referrerPolicy: 'no-referrer',
    });
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    return { status: response.status, body: json };
  } catch {
    return { networkError: true };
  } finally {
    window.clearTimeout(timer);
  }
}

async function run(action: ConsentAction, body: Record<string, unknown>): Promise<void> {
  if (busy) return;
  busy = true;
  confirmButton.disabled = true;
  revokeButton.disabled = true;
  status.textContent = "Réveil du serveur… cela peut prendre jusqu'à 2 minutes";
  status.hidden = false;
  const outcome = await call(action, body);
  status.hidden = true;
  busy = false;
  confirmButton.disabled = false;
  revokeButton.disabled = false;
  const view = describeOutcome(outcome);
  // A refused action keeps the page as it was: only the error is added.
  if (view.panel === 'error' && action !== 'lookup') {
    showError(view.lines);
    return;
  }
  render(view);
}

// Read the token, then take it out of the address bar and history right away.
const token = readToken(window.location.search);
if (token) {
  window.history.replaceState(null, '', window.location.pathname);
}

if (!token) {
  showError([MISSING_TOKEN]);
} else {
  void run('lookup', { token });

  confirmForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!acceptData.checked || !acceptHealth.checked) {
      showError(['Cochez les deux cases pour donner votre accord.']);
      return;
    }
    void run('confirm', {
      token,
      acceptDataProcessing: true,
      acceptHealthData: true,
    });
  });

  revokeButton.addEventListener('click', () => {
    const ok = window.confirm(
      'Confirmer ? Le compte de votre enfant sera limité et ses certificats médicaux supprimés.',
    );
    if (ok) void run('revoke', { token });
  });
}
