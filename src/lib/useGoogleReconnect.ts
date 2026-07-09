import { useEffect, useRef, useState } from "react";
import { startGoogleReconnect } from "./api";
import { toastError, toastOk } from "./toast";

// Drives the one-click Google reconnect from anywhere in the portal:
//   1. ask the edge fn for the signed consent URL
//   2. open it in a popup (falls back to a new tab if popups are blocked)
//   3. when the popup closes, the flow is done — toast + fire onDone() so the
//      caller can refetch connection status.
// The callback popup lives on the Supabase functions origin, so we can't read its
// contents cross-origin — polling `popup.closed` is the reliable completion signal.
export function useGoogleReconnect(onDone?: () => void): { reconnect: () => void; busy: boolean } {
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  async function reconnect() {
    if (busy) return;
    setBusy(true);
    try {
      const url = await startGoogleReconnect();
      const popup = window.open(url, "google-oauth", "width=520,height=680");
      if (!popup) {
        // Popup blocked — open in a new tab instead; we can't watch it, so just
        // clear busy and let the user refresh status when they return.
        window.open(url, "_blank");
        setBusy(false);
        return;
      }
      timer.current = window.setInterval(() => {
        if (popup.closed) {
          if (timer.current) window.clearInterval(timer.current);
          timer.current = null;
          setBusy(false);
          toastOk("Google reconnected. Checking connection…");
          onDoneRef.current?.();
        }
      }, 700);
    } catch (e) {
      setBusy(false);
      toastError(e instanceof Error ? e.message : String(e));
    }
  }

  return { reconnect, busy };
}
