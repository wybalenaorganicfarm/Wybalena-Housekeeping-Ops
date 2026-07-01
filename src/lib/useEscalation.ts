import { useEffect, useState } from "react";
import { getCronSchedules } from "./api";
import { fmtRelative, nextCronRun } from "./cron";

// Label for the next Tier-3 escalation ("in ~5h" / "Wed 1:45 PM"), computed from
// the admin-configured escalate-tier-3 schedule. Returns null when unavailable
// (non-admin has no cron access, the job is paused, or the cron is exotic) — the
// caller then shows a time-less fallback instead of a hardcoded countdown.
export function useEscalationLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getCronSchedules()
      .then((jobs) => {
        const job = jobs.find((j) => j.fn === "escalate-tier-3" && j.active);
        const next = job ? nextCronRun(job.schedule) : null;
        if (live) setLabel(next ? fmtRelative(next) : null);
      })
      .catch(() => { /* no cron access (e.g. team leader) — leave null */ });
    return () => { live = false; };
  }, []);
  return label;
}
