---
name: cloud-sync
description: Check claude-mem sync with the fleet's self-hosted sync hub. Use when the user says "sync status", "is memory syncing", "set up sync", or asks whether memory from another machine has arrived.
allowed-tools:
  - Bash
  - Read
---

# Sync (self-hosted hub)

The installed worker syncs through the fleet's own sync hub (the PWM fork of claude-mem,
`services/sync-api` run on grokrlabs). There is one client, one durable operation log, and no
separate sync daemon. Sync is on when `CLAUDE_MEM_CLOUD_SYNC_TOKEN`, `CLAUDE_MEM_CLOUD_SYNC_USER_ID`
and `CLAUDE_MEM_CLOUD_SYNC_HUB_URL` in `~/.claude-mem/settings.json` are all set; the fleet's
configuration writes them, with a per-device token from the secrets broker.

**Security rule:** never print the sync token, put it in a command, argv or a log, or ask for it in
chat. Anything pasted into a chat lands in the transcript, which claude-mem itself captures.

## 1. Check status

```bash
PORT="${CLAUDE_MEM_WORKER_PORT:-$(node -e "const fs=require('fs'),p=require('path'),os=require('os');const uid=(typeof process.getuid==='function'?process.getuid():77);const fallback=String(37700+(uid%100));try{const s=JSON.parse(fs.readFileSync(p.join(os.homedir(),'.claude-mem','settings.json'),'utf-8'));process.stdout.write(String(s.CLAUDE_MEM_WORKER_PORT||fallback));}catch{process.stdout.write(fallback);}" 2>/dev/null)}"
curl -s "http://127.0.0.1:${PORT}/api/sync/status"
```

- `configured: true` and `hub.reachable: true`: the worker completed an authenticated status probe
  against the hub. Report `deviceId`, pending counts, `lastFlushAt`, `lastError`, and the hub
  head/checkpoint.
- `configured: true` and `hub.reachable: false`: report `hub.error`. A zero pending count or
  `lastError: null` is not success, because an empty queue performs no push.
- `configured: false`: the three settings are not all set on this device; report that.
- Connection refused, 404 or 503 right after a restart: retry every three seconds for about 30 seconds.

The local route always makes an authenticated, read-only hub status probe (`GET /v1/sync/status`),
even when every pending count is zero, and never appends or advances sync state. Pending counts
cover only writes made after the sync launch baseline; history before it is uploaded once by
`bun scripts/pwm-sync-backfill.ts --apply` in the fork.

## 2. Report

Report device id, pending counts, last successful flush, hub reachability and checkpoint, and any
hub or flush error. Never include the token.
