---
name: claude-mem-install
description: >-
  Use this when setting up claude-mem on Grok Bot: local worker with a personal
  OpenRouter key or the optional host-login observer. No Cursor required.
---
# Install claude-mem on Grok Bot

Independent of Cursor. Grok Bot has no session-start / file-read / tool-use hooks.

## Local worker

```
npx github:JonathanWorks/claude-mem#pwm install --ide grok-bot --provider openrouter
```

- Worker on `127.0.0.1:<port>` (default `37700 + uid%100`). Do not restart if healthy.
- Transcript watcher per Grok Bot agent (`platformSource=grok-bot`)
- Observer via your own OpenRouter key (`CLAUDE_MEM_OPENROUTER_API_KEY`)
- MCP `session_start_context` at the start of a real task
- Live INDEX into `agents/<uuid>/memory/log/zz-claude-mem-inject.md` (disable with `CLAUDE_MEM_GROK_BOT_INJECT_ENABLED=false`)

## Optional: local host-login observer

```
npx github:JonathanWorks/claude-mem#pwm install --ide grok-bot --provider host
```

Loopback OpenAI-compatible shim on a **free** loopback port (not the worker port). Idle replies are `<skip_summary />`; finished units are one `<observation>`. This Grok login fulfills inbox jobs (skill host-observer).

## Remote worker

```
npx github:JonathanWorks/claude-mem#pwm install --ide grok-bot --runtime server --server-url https://YOUR_HOST
```
