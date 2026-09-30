"use client";

/**
 * Chrome/Edge "Install app" support.
 *
 * `beforeinstallprompt` fires once, very early — often before React has
 * hydrated — and the event is only usable if you keep a reference to it. The
 * inline script in app/layout.tsx stashes it on window and re-announces it;
 * this hook just reads that stash, so a late-mounting menu can still install.
 *
 * Chrome only fires the event when the app is genuinely installable (valid
 * manifest, 192+512 icons, service worker with a fetch handler, HTTPS), so
 * `canInstall` doubles as an honest capability check: no event, no button,
 * rather than a button that does nothing.
 */

import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __engineInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

/** Already running as an installed app — nothing to offer. */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's non-standard flag
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandalone()) { setInstalled(true); return; }

    const sync = () => setCanInstall(!!window.__engineInstallPrompt);
    sync(); // the event may already have fired and been stashed

    const onReady = () => sync();
    const onInstalled = () => {
      window.__engineInstallPrompt = null;
      setCanInstall(false);
      setInstalled(true);
    };
    window.addEventListener("engine-installprompt", onReady);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("engine-installprompt", onReady);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const evt = window.__engineInstallPrompt;
    if (!evt) return "unavailable" as const;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    // The event is single-use — Chrome will fire a fresh one if the user
    // dismisses and stays eligible.
    window.__engineInstallPrompt = null;
    setCanInstall(false);
    return outcome;
  }, []);

  return { canInstall, installed, promptInstall };
}
