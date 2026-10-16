import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startSessionSync } from './session/sessionSync';

// Before the first render: a tab opened from another one (middle click) asks
// it for the admin session instead of showing the login page (#669).
void startSessionSync();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
