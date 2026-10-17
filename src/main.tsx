import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

/**
 * The offline shell, in production only.
 *
 * Development runs through Vite's own server, where a worker caching hashed filenames and the
 * app's HTML would fight the dev server's reloads for no benefit.
 *
 * Registered after `load` so the first paint never waits on it, and with
 * `updateViaCache: 'none'` so an old copy of the worker itself cannot hide the next deploy.
 * Failure is ignored: no worker simply means no offline support.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .catch(() => undefined)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
