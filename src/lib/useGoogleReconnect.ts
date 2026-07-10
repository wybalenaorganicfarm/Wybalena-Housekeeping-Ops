import { useCallback, useEffect, useRef, useState } from "react";
import { getConnectionStatus, startGoogleReconnect } from "./api";
import { toast, toastError, toastOk } from "./toast";

// The callback 302-redirects the popup to /google-oauth-result.html on OUR origin
// (Supabase serves function HTML as text/plain, so its script can't run). That page
// posts the result back — BUT Google's consent pages send Cross-Origin-Opener-Policy,
// which severs window.opener as the popup navigates through Google. So the postMessage
// often never arrives even on success. We therefore treat the DATABASE as the source
// of truth: when the popup closes, we re-check connection status and compare the
// Google "connected_at" against a baseline. A changed timestamp = a real connection,
// no matter whether the postMessage survived. postMessage stays as a fast path.
const RESULT_ORIGIN = (() => {
  try { return window.location.origin; } catch { return ""; }
})();

export function useGoogleReconnect(onDone?: () => void): { reconnect: () => void; busy: boolean } {
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const handlerRef = useRef<((e: MessageEvent) => void) | null>(null);
  const settled = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Stable teardown: always removes the exact listener that was added.
  const cleanup = useCallback(() => {
    if (timer.current) { window.clearInterval(timer.current); timer.current = null; }
    if (handlerRef.current) { window.removeEventListener("message", handlerRef.current); handlerRef.current = null; }
    setBusy(false);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const reconnect = useCallback(async () => {
    if (handlerRef.current) return; // a flow is already in progress
    setBusy(true);
    settled.current = false;
    try {
      const url = await startGoogleReconnect();
      const popup = window.open(url, "google-oauth", "width=520,height=680");
      if (!popup) window.open(url, "_blank"); // popup blocked — still receives the message

      // Baseline the current connection timestamp WITHOUT blocking the popup open.
      // A fresh connect sets connected_at = now(), so a changed value = success.
      const baselineP = getConnectionStatus()
        .then((s) => s.google?.connectedAt ?? null)
        .catch(() => null);

      // Authoritative outcome from the DB (survives a severed window.opener).
      const connectedFresh = async (): Promise<boolean> => {
        const [baseline, now] = await Promise.all([
          baselineP,
          getConnectionStatus().then((s) => s.google?.connectedAt ?? null).catch(() => null),
        ]);
        return !!now && now !== baseline;
      };

      const finish = (ok: boolean) => {
        if (ok) toastOk("Google reconnected.");
        else toast("Reconnect cancelled — Google was not connected.");
        onDoneRef.current?.();
      };

      // Fast path: if opener survived, the result page tells us directly.
      const handler = (e: MessageEvent) => {
        if (RESULT_ORIGIN && e.origin !== RESULT_ORIGIN) return;
        const data = e.data as { source?: string; ok?: boolean } | null;
        if (!data || data.source !== "google-oauth") return;
        settled.current = true;
        cleanup();
        if (data.ok) { toastOk("Google reconnected."); onDoneRef.current?.(); }
        else { toastError("Google wasn't reconnected — the sign-in didn't complete. Please try again."); onDoneRef.current?.(); }
      };
      handlerRef.current = handler;
      window.addEventListener("message", handler);

      // The window closed without a message. Don't assume "cancelled" — Google's COOP
      // usually severs the postMessage even on success. Ask the DB what really happened.
      timer.current = window.setInterval(() => {
        if (popup && popup.closed && !settled.current) {
          settled.current = true;
          cleanup();
          connectedFresh().then(finish);
        }
      }, 700);
    } catch (e) {
      cleanup();
      toastError(e instanceof Error ? e.message : String(e));
    }
  }, [cleanup]);

  return { reconnect, busy };
}
