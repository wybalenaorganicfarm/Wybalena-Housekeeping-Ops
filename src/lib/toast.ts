// Themed toast helpers — replaces window.alert() across the app.
// Mount <Toaster/> once (see main.tsx); call toastError / toastOk anywhere.
import toast from "react-hot-toast";
import { c, font } from "../theme";

const base = {
  fontFamily: font.body,
  fontSize: 13.5,
  fontWeight: 500,
  color: c.ink,
  border: `1px solid ${c.border2}`,
  borderRadius: 10,
  padding: "11px 14px",
  boxShadow: "0 12px 32px -12px rgba(20,30,25,.35)",
  maxWidth: 380,
};

export function toastOk(message: string) {
  return toast.success(message, {
    style: base,
    iconTheme: { primary: c.greenMid, secondary: "#fff" },
  });
}

export function toastError(message: string) {
  return toast.error(message, {
    style: base,
    iconTheme: { primary: c.danger, secondary: "#fff" },
  });
}

export { toast };
