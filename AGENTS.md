# AGENTS.md - Developer & Agent Guidelines

This document provides guidelines, architectural details, and strict requirements for AI agents and human maintainers working on the `light` codebase.

---

## 1. Project Core Mandates

- **Package Manager**: Always use `pnpm` for package installation and management (`pnpm add`, `pnpm install`).
- **Runtime & Test Runner**: Use `bun` for script execution and `bun test` for unit testing.
- **TypeScript & ESM**:
  - All source files reside in `src/`.
  - Project uses ESM with `NodeNext` module resolution and `.js` extension specifiers in imports (e.g., `import { RpcEngine } from './rpc.js';`).
  - Declarations and JS output are generated in `dist/` via `tsc`.

---

## 2. Architecture & File Structure

```
src/
├── index.ts           # Primary package entry point and exports
├── peer.ts            # LightPeer class, RTCPeerConnection lifecycle & auto-reconnect state machine
├── rpc.ts             # RpcEngine: Protobuf binary request-response matching & call queuing
├── datagram.ts        # DatagramEngine: Protobuf binary unreliable pub/sub messaging engine
├── proto/
│   ├── protocol.proto # Protocol Buffers schema file
│   └── protocol.ts    # Generated TS interfaces and Protobuf binary encoders/decoders
├── webrtc-adapter.ts  # Environment detection (browser native vs werift in Node/Bun)
├── errors.ts          # Custom error hierarchy
└── types.ts           # Protocol message interfaces and generic helpers
```

---

## 3. Key Operational Requirements

### A. WebRTC Runtime Fallback
- `getWebRTCAdapter()` must automatically detect global browser `RTCPeerConnection` first.
- If native WebRTC is absent, it falls back to `werift` in Node.js/Bun.
- Developers can override or polyfill via `options.webrtc` or `setWebRTCAdapter()`.

### B. Seamless Call Queuing
- Calls to `peer.call(...)` made before WebRTC data channels are ready or while reconnecting **MUST NOT throw immediately**.
- Outbound requests are placed in `queuedRequests` inside `RpcEngine`.
- Outbound responses generated before data channel `onopen` completes are buffered in `outboundResponsesQueue`.
- When the RPC data channel opens, `flushQueue()` sends all buffered responses and requests in order.

### C. Auto-Reconnection & Max Retries
- Disconnections (`disconnected` / `failed` connection states or data channel closures) trigger `handleDisconnect()`.
- Reconnection attempts run up to `maxRetries` (default: 3).
- Each attempt emits a `'reconnecting'` event with the attempt number.
- If reconnection succeeds, pending queues flush and state returns to `connected`.
- If maximum retries are exceeded:
  - Emits `'error'` (`MaxRetriesExceededError`) and `'reconnectFailed'`.
  - Rejects all queued promises with `MaxRetriesExceededError`.
  - Calls `peer.close()`.

### D. Single-Origin Web Server Conventions
- Web examples (`example/web/server.ts`) must run the HTTP/HTTPS web application server AND the WebSocket signaling server (`/ws`) on the **same port/origin**.
- This avoids cross-port TLS certificate mismatch issues in browsers (such as Firefox `NS_ERROR_NET_EMPTY_RESPONSE`).

---

## 4. Verification Workflow

Before completing any task, execute the build and test verification suite:

```bash
# 1. Build TypeScript and typecheck
bun run build

# 2. Run all unit tests
bun test
```

Ensure all tests pass and `dist/` compiles with zero errors.
