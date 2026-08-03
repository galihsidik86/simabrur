import { useEffect, useState } from 'react';

/* ===== Prompt "Pasang aplikasi" (beforeinstallprompt) ===== */
let deferredPrompt: (Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> }) | null = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as never;
  window.dispatchEvent(new Event('pwa:installable'));
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  window.dispatchEvent(new Event('pwa:installed'));
});

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(!!deferredPrompt);
  useEffect(() => {
    const on = () => setCanInstall(true);
    const off = () => setCanInstall(false);
    window.addEventListener('pwa:installable', on);
    window.addEventListener('pwa:installed', off);
    return () => {
      window.removeEventListener('pwa:installable', on);
      window.removeEventListener('pwa:installed', off);
    };
  }, []);
  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => undefined);
    deferredPrompt = null;
    setCanInstall(false);
  };
  return { canInstall, install };
}

/** Pilih manifest sesuai portal yang dibuka (Jamaah vs Agen) — SPA satu origin. */
export function setManifestForRoute(path = window.location.pathname) {
  const href = path.startsWith('/portal-agen')
    ? '/manifest-agen.webmanifest'
    : path.startsWith('/portal') || path.startsWith('/daftar')
      ? '/manifest-jamaah.webmanifest'
      : null;
  let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
  if (!href) {
    if (link) link.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

export function initPwa() {
  setManifestForRoute();
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
}
