# skill

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run relay.ts
```

Health checks:

```bash
# full health check (JSON details + status code)
curl http://127.0.0.1:9222/health
```

Utility scripts:

```bash
# get active target id
bun .agents/skills/vibe-browser-skill/get-active-target.ts

# record network events (HTTP + WS)
bun .agents/skills/vibe-browser-skill/record-network.ts <targetId>
```

This project was created using `bun init` in bun v1.3.6. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
