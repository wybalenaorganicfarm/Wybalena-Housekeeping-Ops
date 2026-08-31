// health-check — cron: daily 07:00 IST testing (01:30 UTC); go-live tz TBD.
// Probes every external connection with READ-ONLY calls (no messages/emails are
// triggered) and emails an alert listing any broken connection.
//
// Connections checked:
//   - supabase  : a trivial DB read via the service-role client
//   - whapi     : GET /health (channel reachable)
//   - gmail     : users.getProfile (token valid, send scope account live)
//   - google_calendar : calendars.get (token valid, calendar readable)
//
// A connection with missing creds reports configured:false and is NOT treated
// as a failure (the adapter is intentionally stubbed until creds are wired).
// Only configured-but-failing connections raise the alert.
//
// Recipient: the Operations Manager (see _shared/admin.ts), the same person who
// receives every other notification in the system. HEALTHCHECK_ALERT_TO is the
// email fallback for before one is designated.
//
// If Gmail itself is the broken connection the alert email cannot be delivered,
// so the notice falls back to WhatsApp — to her profile phone, or to
// ALERT_WHATSAPP_TO. Set that env var: it is the only destination that does not
// depend on profile data being filled in. When she cannot be reached at ALL the
// run is logged as `failed` with the reason, because a warning that reaches no
// one is worse than the outage it was reporting.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { opsManager } from "../_shared/admin.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { checkHealth as checkWhapi, sendMessage } from "../_shared/adapters/whatsapp.ts";
import { checkHealth as checkGmail } from "../_shared/adapters/email.ts";
import { checkHealth as checkCalendar } from "../_shared/adapters/calendar.ts";
import { renderTemplate } from "../_shared/templates.ts";
import { describeError } from "../_shared/describeError.ts";

interface HealthResult {
  name: string;
  configured: boolean;
  ok: boolean;
  detail: string;
}

// Friendly name + real-world impact for each connection, so a non-technical
// reader knows what actually breaks.
const SERVICE: Record<string, { label: string; impact: string }> = {
  supabase: { label: "App Database", impact: "The app may not load or save data correctly." },
  whapi: { label: "WhatsApp Messaging", impact: "Cleaners won't receive shift offers or reminders on WhatsApp." },
  gmail: { label: "Email Sending (Gmail)", impact: "The system can't send confirmation, reminder or alert emails." },
  google_calendar: { label: "Booking Calendar (Google Calendar)", impact: "New bookings won't sync in and shifts may not be auto-created." },
};

// Turn a raw technical `detail` string into a plain-English problem + next steps.
function diagnose(label: string, detail: string): { problem: string; steps: string[] } {
  const d = detail.toLowerCase();
  if (/403|insufficient|scope|permission_denied|forbidden/.test(d)) {
    return {
      problem: `The ${label} account is connected, but it no longer has permission to do what the system needs.`,
      steps: [
        `Ask your developer/administrator to reconnect the ${label} account and re-approve all the requested permissions.`,
        "This usually happens when the login was set up without ticking every permission, or permissions were later removed.",
      ],
    };
  }
  if (/401|unauthor|refresh-token|invalid.*token|token.*expired|credential/.test(d)) {
    return {
      problem: `The system's login to ${label} has expired or is no longer valid.`,
      steps: [
        `Ask your developer/administrator to sign in again and reconnect the ${label} account.`,
        "This can happen if the password changed, or access was revoked.",
      ],
    };
  }
  if (/404|not.?found/.test(d)) {
    return {
      problem: `A setting for ${label} points to something that can't be found (for example, the wrong account or calendar).`,
      steps: [`Ask your developer/administrator to check the ${label} settings (the configured ID may be wrong).`],
    };
  }
  if (/50\d|timeout|timed out|network|econn|unreachable|enotfound|fetch/.test(d)) {
    return {
      problem: `${label} couldn't be reached just now. This is usually a temporary outage on their side.`,
      steps: [
        "No action is usually needed — it often recovers on its own by the next check.",
        "If these alerts keep coming for a few hours, let your developer/administrator know.",
      ],
    };
  }
  return {
    problem: detail.trim()
      ? `${label} reported an unexpected error.`
      : `${label} failed a check but reported no error message — this is usually a brief network glitch rather than a real outage.`,
    steps: [`Please forward this email to your developer/administrator to look into the ${label} connection.`],
  };
}

async function checkSupabase(): Promise<HealthResult> {
  // A single failed probe is not an outage. The DB is the one connection we can
  // cheaply verify twice, and a transient blip on one request has already
  // produced a false "App Database is down" alert (28 Aug 2026) — that same run
  // then wrote its own warning row to this very database, proving it was up.
  // Two failures a few seconds apart is the bar for waking anyone.
  let last = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const sb = serviceClient();
      // Trivial read — confirms DB + service-role key are working. No writes.
      // Deliberately not head:true — a HEAD response carries no body, so a
      // failure can surface as an error object with an empty message, and the
      // alert email's "Technical detail" line then renders blank.
      const { error } = await sb.from("cleaners").select("id").limit(1);
      if (!error) {
        return {
          name: "supabase",
          configured: true,
          ok: true,
          detail: attempt === 1
            ? "database reachable, service role valid"
            : "database reachable, service role valid (recovered on retry)",
        };
      }
      last = describeError(error);
    } catch (e) {
      last = describeError(e);
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 3000));
  }
  return {
    name: "supabase",
    configured: true,
    ok: false,
    detail: `${last} (failed twice, 3s apart)`,
  };
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();

  // Run all probes concurrently. All are read-only.
  const results: HealthResult[] = await Promise.all([
    checkSupabase(),
    checkWhapi(),
    checkGmail(),
    checkCalendar(),
  ]);

  const broken = results.filter((r) => r.configured && !r.ok);
  const unconfigured = results.filter((r) => !r.configured).map((r) => r.name);

  if (broken.length > 0) {
    // Keep the raw detail in the logs for developers…
    console.error(`[health-check] BROKEN CONNECTIONS:\n${broken.map((b) => ` • ${b.name}: ${b.detail}`).join("\n")}`);

    // …but send a human-readable email with impact + steps, not raw JSON.
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const cards = broken.map((b) => {
      const svc = SERVICE[b.name] ?? { label: b.name, impact: "" };
      const dx = diagnose(svc.label, b.detail);
      const steps = dx.steps.map((s) => `<li style="margin:4px 0;">${esc(s)}</li>`).join("");
      return `<tr><td style="padding:16px 18px;border:1px solid #eee;border-radius:8px;background:#fff;">
        <div style="font-size:15px;font-weight:700;color:#1c241f;">⚠️ ${esc(svc.label)}</div>
        <div style="font-size:13.5px;color:#5d665f;margin-top:8px;line-height:1.55;"><strong>What's wrong:</strong> ${esc(dx.problem)}</div>
        ${svc.impact ? `<div style="font-size:13.5px;color:#5d665f;margin-top:6px;line-height:1.55;"><strong>What this affects:</strong> ${esc(svc.impact)}</div>` : ""}
        <div style="font-size:13.5px;color:#1c241f;margin-top:8px;"><strong>What to do:</strong></div>
        <ul style="font-size:13px;color:#5d665f;margin:4px 0 0;padding-left:20px;line-height:1.5;">${steps}</ul>
        <div style="font-size:11px;color:#a39d91;margin-top:10px;">Technical detail (for your developer): ${esc(b.detail)}</div>
      </td></tr>`;
    }).join(`<tr><td style="height:12px;"></td></tr>`);

    const html = `<!DOCTYPE html><html><body style="margin:0;background:#eef0ee;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ee;padding:24px 0;"><tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:#a8392b;border-radius:10px 10px 0 0;padding:20px 22px;color:#fff;">
          <div style="font-size:17px;font-weight:700;">Some connections need attention</div>
          <div style="font-size:12.5px;opacity:.9;margin-top:3px;">The daily automatic check found ${broken.length} connection(s) not working.</div>
        </td></tr>
        <tr><td style="background:#fff;padding:18px 18px 8px;color:#5d665f;font-size:13.5px;line-height:1.55;border-left:1px solid #eee;border-right:1px solid #eee;">
          Here's what's affected and what to do. You don't need to be technical — follow the steps, or forward this to whoever manages the system.
        </td></tr>
        <tr><td style="background:#fff;padding:8px 18px 20px;border:1px solid #eee;border-top:0;border-radius:0 0 10px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table>
          ${unconfigured.length ? `<div style="font-size:11.5px;color:#a39d91;margin-top:14px;">Not set up yet (skipped, not a problem): ${esc(unconfigured.join(", "))}</div>` : ""}
        </td></tr>
      </table>
    </td></tr></table>
    </body></html>`;

    const text = `The daily connection check found ${broken.length} connection(s) not working:\n\n` +
      broken.map((b) => {
        const svc = SERVICE[b.name] ?? { label: b.name, impact: "" };
        const dx = diagnose(svc.label, b.detail);
        return `• ${svc.label}\n  What's wrong: ${dx.problem}\n${svc.impact ? `  Affects: ${svc.impact}\n` : ""}  What to do: ${dx.steps.join(" ")}\n  (Technical: ${b.detail})`;
      }).join("\n\n") +
      (unconfigured.length ? `\n\nNot set up yet (skipped): ${unconfigured.join(", ")}` : "");

    const brokenLabels = broken.map((b) => SERVICE[b.name]?.label ?? b.name).join(", ");

    // Surface in the in-app Alerts queue too, so a disconnect is visible in the
    // portal (not only by email/WhatsApp). Keep a single open alert at a time:
    // refresh the existing one if present, otherwise insert.
    // Wording must match get-connection-status's reconcileAlert, which retitles
    // this same alert as connections recover.
    const alertTitle = `${broken.length} connection${broken.length === 1 ? "" : "s"} need${broken.length === 1 ? "s" : ""} attention`;
    const alertBody = `Not working: ${brokenLabels}. Open Connections (Administration) to reconnect.`;
    const { data: openConn } = await sb
      .from("alerts")
      .select("id")
      .eq("alert_type", "connection_down")
      .eq("status", "open");
    if (openConn && openConn.length) {
      await sb.from("alerts")
        .update({ title: alertTitle, body: alertBody })
        .eq("alert_type", "connection_down")
        .eq("status", "open");
    } else {
      await sb.from("alerts")
        .insert({ alert_type: "connection_down", title: alertTitle, body: alertBody });
    }

    // Notify the Operations Manager — she runs the portal, and every other
    // notification in the system goes to her. Prefer email; but if Gmail itself
    // is one of the failures, email won't send, so fall back to WhatsApp. (If
    // both are down we can't reach her — still logged + console.error'd above.)
    const gmailBroken = broken.some((b) => b.name === "gmail");
    const whatsappBroken = broken.some((b) => b.name === "whapi");
    const ops = await opsManager(sb);

    let emailed = false;
    if (!gmailBroken) {
      const sent = await sendEmail(
        `Wybalena: ${broken.length} connection(s) need attention`,
        text,
        // HEALTHCHECK_ALERT_TO stays as the fallback for before an operations
        // manager is designated (or for routing a copy to the developer).
        ops.email ?? Deno.env.get("HEALTHCHECK_ALERT_TO") ?? undefined,
        html,
      );
      emailed = sent.ok;
    }

    let whatsapped = false;
    // Why the WhatsApp leg didn't run / didn't reach her. Recorded verbatim so a
    // silent non-delivery can never again look like a transient blip: this exact
    // fallback sat broken for four days because the manager's profile had no
    // phone saved, and the old log line ("Neither email nor WhatsApp could be
    // used") gave no clue that a missing phone number was the reason.
    let waSkipReason: string | null = null;
    if (emailed) {
      waSkipReason = null;
    } else if (whatsappBroken) {
      waSkipReason = "WhatsApp is one of the broken connections";
    } else if (!ops.phone) {
      waSkipReason = `${ops.name} has no WhatsApp number saved on her profile, and ALERT_WHATSAPP_TO is not set`;
    } else {
      const waText = await renderTemplate(sb, "connection_alert_whatsapp",
        `⚠️ *Wybalena system alert*\n\n${broken.length} connection(s) are not working: ${brokenLabels}.\n\n` +
        `Email alerts couldn't be sent${gmailBroken ? " (Gmail is one of the failures)" : ""}, ` +
        `so you're getting this on WhatsApp. Please open the app to review.`,
        { count: broken.length, connections: brokenLabels });
      const r = await sendMessage(ops.phone, waText);
      whatsapped = r.ok;
      if (!r.ok) waSkipReason = "WhatsApp rejected the message";
    }

    // Nobody was reached at all — the check did its job but the warning went
    // nowhere, which is strictly worse than a broken connection on its own.
    // 'failed' (not 'warning') so it stands out in System Logs as needing action.
    const unreachable = !emailed && !whatsapped;

    const channelNote = emailed
      ? ` An email with next steps was sent to ${ops.name}.`
      : whatsapped
        ? ` Email was unavailable, so ${ops.name} was notified on WhatsApp instead.`
        : ` NOBODY WAS NOTIFIED — email was unavailable and the WhatsApp fallback could not be used: ${waSkipReason}.` +
          ` Add a mobile number to the Operations Manager in Users so these alerts can reach her.`;

    await writeAuditLog(sb, {
      event_type: "health.check",
      event_label: "Connection Health Check",
      status: unreachable ? "failed" : "warning",
      summary: `Daily connection check found ${broken.length} connection(s) not working: ${brokenLabels}.${channelNote}`,
      error_message: unreachable ? `No alert could be delivered: ${waSkipReason}` : undefined,
      detail: {
        not_working: broken.map((b) => SERVICE[b.name]?.label ?? b.name),
        not_configured: unconfigured,
        notified: ops.name,
        notified_by: emailed ? "email" : whatsapped ? "whatsapp" : "none",
        whatsapp_skip_reason: waSkipReason,
      },
      source: "health-check",
      triggered_by: "cron",
    });
  } else {
    // Everything healthy → auto-resolve any open connection alert from a prior run.
    await sb.from("alerts")
      .update({ status: "actioned", actioned_at: new Date().toISOString() })
      .eq("alert_type", "connection_down")
      .eq("status", "open");

    // Always log the run, so a healthy day is visible in System Logs too.
    const working = results.filter((r) => r.configured && r.ok).map((r) => SERVICE[r.name]?.label ?? r.name);
    await writeAuditLog(sb, {
      event_type: "health.check",
      event_label: "Connection Health Check",
      status: "success",
      summary: `Daily connection check passed. All ${working.length} connection(s) working` +
        (unconfigured.length ? `; ${unconfigured.length} not set up yet.` : "."),
      detail: { working, not_configured: unconfigured },
      source: "health-check",
      triggered_by: "cron",
    });
  }

  return json({
    ok: broken.length === 0,
    checkedAt: new Date().toISOString(),
    results,
    broken: broken.map((b) => b.name),
    unconfigured,
  });
});
