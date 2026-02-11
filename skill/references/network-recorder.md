# Network Recorder (HTTP + WebSocket)

Script: `.agents/skills/vibe-browser/record-network.ts`

Purpose: subscribe to CDP `Network.*` events via the vibe-browser relay and write both HTTP request/response and WebSocket handshake/frames into a single JSONL file for offline analysis.

## Usage

```bash
bun .agents/skills/vibe-browser/record-network.ts <targetId> [outFile] [autoStopMs]
```

Via environment variables:

```bash
TARGET_ID=... bun .agents/skills/vibe-browser/record-network.ts
OUT_FILE=...  bun .agents/skills/vibe-browser/record-network.ts
```

Default output: `network-events.jsonl`

## Core environment variables

| Variable | Description | Default |
|---------|-------------|---------|
| `RELAY_URL` | relay base URL | `http://localhost:9222` |
| `OUT_FILE` | output file (must end with `.jsonl`) | `network-events.jsonl` |
| `AUTO_STOP_MS` | auto stop after N ms (also supported as the 3rd positional arg) | 0 |
| `ALL_TARGETS=1` | record events from all targets | false |
| `RAW=1` | include raw `forwardCDPEvent` payloads | false |
| `INCLUDE_HTTP=0` | disable HTTP recording | enabled |
| `INCLUDE_WS=0` | disable WebSocket recording | enabled |
| `JSONL_INDENT=0|2|...` | JSON indentation per record (`0` for one-line JSON) | 2 |

## HTTP options

| Variable | Description | Default |
|---------|-------------|---------|
| `HTTP_ONLY=1` | only record `http(s)` URLs | false |
| `MAX_BODY_CHARS=0` | truncate request/response bodies (`0` = no truncation) | 0 |

## WebSocket options

| Variable | Description | Default |
|---------|-------------|---------|
| `URL_INCLUDES=...` | only keep sockets whose URL contains this substring | empty |
| `MAX_PAYLOAD_CHARS=0` | truncate `payloadData` (`0` = no truncation) | 0 |
| `REDACT_HEADERS=1` | redact Cookie/Authorization headers in handshake records | false |

## Examples

```bash
# record HTTP + WS, stop after 30 seconds
bun .agents/skills/vibe-browser/record-network.ts <targetId> network-events.jsonl 30000

# HTTP only
INCLUDE_WS=0 HTTP_ONLY=1 bun .agents/skills/vibe-browser/record-network.ts <targetId> network-requests.jsonl 20000

# WS only, and only sockets containing "gmgn.ai"
INCLUDE_HTTP=0 URL_INCLUDES=gmgn.ai bun .agents/skills/vibe-browser/record-network.ts <targetId> ws.jsonl 20000
```

## Record types (`type`)

- `recorder_start` / `recorder_stop`
- `status`
- `sse_parse_error`
- `http`
- `ws_created`
- `ws_handshake_request`
- `ws_handshake_response`
- `ws_frame`
- `ws_closed`
- `ws_frame_error`
