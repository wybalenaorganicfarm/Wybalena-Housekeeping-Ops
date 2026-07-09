import { useCallback, useEffect, useRef, useState } from "react";
import { startGoogleReconnect } from "./api";
import { toast, toastError, toastOk } from "./toast";

// Origin the callback popup posts its result from (the Supabase functions host).
const FUNCTIONS_ORIGIN = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL as string).origin; } catch { return ""; }
})();

// Drives the one-click Google reconnect from anywhere in the portal:
//   1. ask the edge fn for the signed consent URL (passing our origin)
//   2. open it in a popup
//   3. the callback page postMessages {source:"google-oauth", ok} back to us —
//      that is the AUTHORITATIVE result. Only ok:true is success.
//   4. if the popup is closed WITHOUT a message, the user cancelled — we do NOT
//      claim success; we just quietly re-check status.
// We can't read the popup cross-origin, so the postMessage (not popup.closed) is
// what tells us whether auth actually completed.
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

      const handler = (e: MessageEvent) => {
        if (FUNCTIONS_ORIGIN && e.origin !== FUNCTIONS_ORIGIN) return;
        const data = e.data as { source?: string; ok?: boolean } | null;
        if (!data || data.source !== "google-oauth") return;
        settled.current = true;
        cleanup();
        if (data.ok) toastOk("Google reconnected.");
        else toastError("Google wasn't reconnected — the sign-in didn't complete. Please try again.");
        onDoneRef.current?.();
      };
      handlerRef.current = handler;
      window.addEventListener("message", handler);

      // The window closing without ever sending a result = the user cancelled.
      timer.current = window.setInterval(() => {
        if (popup && popup.closed && !settled.current) {
          settled.current = true;
          cleanup();
          toast("Reconnect cancelled — Google was not connected.");
          onDoneRef.current?.(); // status unchanged, but refresh to be sure
        }
      }, 700);
    } catch (e) {
      cleanup();
      toastError(e instanceof Error ? e.message : String(e));
    }
  }, [cleanup]);

  return { reconnect, busy };
}
