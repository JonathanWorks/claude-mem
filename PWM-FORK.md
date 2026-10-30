# PWM fork of claude-mem

`pwm` is this fork's product branch: upstream thedotmack/claude-mem at a release tag (now
v15.6.0) plus a small stack of our commits. `main` mirrors upstream and carries nothing of ours.
A scheduled job replays the stack onto each new upstream release and runs the tests; a conflict
opens a card instead of shipping (Jonathan 2026-10-30: "keep trending off main so we can inherit
new features and releases"). The three fleet hosts install the plugin from this fork. Tracking card:
brw-ho73bm (PWM-OS).

## The stack

1. **Self-hosted sync hub.** `services/sync-api` gains a local token verifier, so the hub runs on
   grokrlabs and clients point `CLAUDE_MEM_CLOUD_SYNC_HUB_URL` at it. No token goes to cmem.ai.
2. **No upsell, no cloud sends.** One switch, on in this fork, turns off every surface below.
3. **One-time history backfill.** Uploads the rows each host excluded at schema migration 47
   (`sync_launch_exclusions`), deduped by origin identity (Jonathan 2026-10-30: "One-time backfill
   of history").
4. **Upstream tracking job.**

## Inventory at v15.6.0 (what commit 2 must turn off)

Promotions. `src/shared/pro-promo.ts` is upstream's single source for the trial pitch; its header
lists every surface:
- session-start banner
- per-message context banner
- first-session welcome hint
- installer "Next Steps" block
- viewer header (separate copy in `src/ui/viewer/constants/promo.ts`)
Seven files import it.

Data sent off the LAN:
- Telemetry: on by default (opt-out), anonymous events to PostHog (`https://us.i.posthog.com`,
  `src/services/telemetry/common.ts`; consent in `src/services/telemetry/consent.ts`).
- Install funnel (v15.2): uploads filtered prompts from the last 30 days to CMEM Cloud for hosted
  intent extraction (`src/npx-cli/commands/install.ts`).
- CMEM Pro inference gateway and decisions gateway (`/api/inference/v1`), reached only when the
  installer writes a Pro memory key; origin from `cmemProOrigin()` in `src/shared/cmem-gateway.ts`.
- Installer sign-in and trial (`/api/installer/oauth/start`, `/api/pro/trial/poll`).
- TeamBrain (`https://cmem.ai/teambrain/...`, `src/npx-cli/commands/teambrain.ts`).
- Hosted sync default `https://sync.cmem.ai`, and media upload to the cmem.ai account when
  `CLAUDE_MEM_MEDIA_CAPTURE_ENABLED` is on.
- cmem.ai MCP endpoint (`https://cmem.ai/api/mcp`).

Not an ad: opencollective/buymeacoffee/patreon appear only as npm funding metadata in
`src/ui/my-work/package-lock.json`.
