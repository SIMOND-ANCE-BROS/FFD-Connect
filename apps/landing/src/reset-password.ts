// Web reset-password page (reset-password/index.html). Serves both "mot de
// passe oublié" emails and Club account invitations: the backend links to
// ${FRONTEND_URL}/reset-password?token=... and the token is consumed here.
import './index.css';
import './legal.css';
import './reset-password.css';
import {
  apiUrl,
  describeResult,
  readToken,
  validatePassword,
  type ApiOutcome,
  type UiResult,
} from './reset-password-logic';

// The beta runs on backend-staging; backend-prod is stopped (see deploy-landing.yml).
const API_BASE = import.meta.env.VITE_API_URL ?? 'https://api-staging.ffd.gabin-simond.fr/api/v1';
// The backend scales to zero: a cold start can take up to ~2 minutes.
const TIMEOUT_MS = 150_000;

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

const messages = must<HTMLDivElement>('[data-messages]');
const form = must<HTMLFormElement>('[data-form]');
const submit = must<HTMLButtonElement>('[data-submit]');
const status = must<HTMLParagraphElement>('[data-status]');
const appBox = must<HTMLParagraphElement>('[data-app]');
const appLink = must<HTMLAnchorElement>('[data-app-link]');
const passwordInput = must<HTMLInputElement>('#reset-password');
const confirmInput = must<HTMLInputElement>('#reset-confirm');

function show(kind: UiResult['kind'], lines: string[]): void {
  messages.replaceChildren(
    ...lines.map((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      return p;
    }),
  );
  messages.dataset.kind = kind;
  messages.hidden = false;
}

// Read the token, then take it out of the address bar and history right away.
const token = readToken(window.location.search);
if (token) {
  window.history.replaceState(null, '', window.location.pathname);
}

if (!token) {
  show('error', [
    "Lien incomplet. Ouvrez le lien reçu par e-mail, ou demandez-en un nouveau depuis l'application (« Mot de passe oublié »).",
  ]);
} else {
  form.hidden = false;
  appLink.href = `ffdconnect://reset-password?token=${encodeURIComponent(token)}`;
  appBox.hidden = false;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void onSubmit(token);
  });
}

async function onSubmit(currentToken: string): Promise<void> {
  if (submit.disabled) return;
  const password = passwordInput.value;
  if (password !== confirmInput.value) {
    show('error', ['Les deux mots de passe ne correspondent pas.']);
    return;
  }
  const problems = validatePassword(password);
  if (problems.length > 0) {
    show('error', problems);
    return;
  }

  messages.hidden = true;
  submit.disabled = true;
  status.textContent = "Réveil du serveur… cela peut prendre jusqu'à 2 minutes";
  status.hidden = false;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  let outcome: ApiOutcome;
  try {
    const response = await fetch(apiUrl(API_BASE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentToken, newPassword: password }),
      signal: controller.signal,
      referrerPolicy: 'no-referrer',
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    outcome = { status: response.status, body };
  } catch {
    outcome = { networkError: true };
  } finally {
    window.clearTimeout(timer);
  }

  status.hidden = true;
  submit.disabled = false;
  const result = describeResult(outcome);
  show(result.kind, result.messages);
  if (result.kind === 'success' || result.linkInvalid) {
    form.hidden = true;
    appBox.hidden = result.kind === 'success';
    passwordInput.value = '';
    confirmInput.value = '';
  }
}
