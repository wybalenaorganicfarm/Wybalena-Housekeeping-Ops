<!-- sipcode:start v=2 -->
<!-- sipcode:block name="output-compression" mode="default" -->
## Sipcode Output Compression

mode: default — optimizes for: diff edits, no ceremony

the rules below apply to your responses in this project. follow them.
they exist so the user pays for code, not for ceremony.
### rules (default mode)

1. **diff-only edits.** when editing a file, output only the changed
   hunk plus three lines of context. never paste the full file back
   when three lines changed. this is the single biggest win.
2. **no preamble.** skip "i'll help with that", "sure", "here's what
   i did". lead with the work. the user can see what you did.
3. **no post-amble.** don't summarize what was just shown unless the
   user explicitly asks for a summary.
4. **code over prose.** when the answer is code, the code is the
   answer. any explanation goes after the code block, not before.
5. **bullets over paragraphs** for any list of options, steps, or
   trade-offs. saves tokens versus flowing prose.
6. **one canonical example, not three.** show one good example. skip
   the exhaustive variants — the user will ask if they want more.
7. **no filler verbs.** drop "let me", "i'll go ahead and", "i'm
   going to". just do the thing.

(installed by sipcode. switch modes with `npx sipcode rules --mode <m>`.
uninstall with `npx sipcode rules --uninstall`.)
<!-- /sipcode:block -->

<!-- sipcode:end -->

## Git workflow

- Do NOT create new branches. Work on the current branch (usually `main`).
- Do NOT commit or push. Leave changes staged/unstaged in the working tree.
- Committing and pushing is done manually by the user.

## Client rule: everything must be visible and editable

Standing requirement from the venue (raised 23 Sep 2026, and from the start of
the project): **every automated behaviour must be visible and switchable from
the app** — no behaviour that only a developer can change.

When adding anything that sends a message, writes an alert, or acts on a
schedule, it is not done until an admin can see it and turn it off:

- **Runs on a clock (cron)** → add to `META` in `src/pages/Schedule.tsx` AND to
  `KNOWN_FNS` in `supabase/functions/manage-cron/index.ts`. Missing from either
  one and it cannot be paused or re-timed from the app.
- **Fires on an event** (a reply, a cancellation, a booking change) → it has no
  cron row, so give it a switch in `app_settings.notification_switches`, read it
  via `loadNotificationSwitches()` before sending, and add a `SwitchRow` to the
  Schedule page.
- **Sends a message** → the wording belongs in `message_templates`, never
  hardcoded, so it shows on the Message Templates page.

Switches default to ON and treat a missing/malformed value as ON: the behaviour
predates the setting, so a silent miss is worse than an unexpected send.
