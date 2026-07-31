# light ⚡

A lightweight, high-performance TypeScript library for reliable **RPC calls** and unreliable **Datagrams** over WebRTC. Works seamlessly across **Browsers, Node.js, and Bun**.

---

## Key Features

- 📦 **Binary-First Protobuf Framing**: All RPC messages, responses, and datagrams are encoded in compact binary **Protocol Buffers** (`src/proto/protocol.proto`). Supports raw `Uint8Array` payloads natively.
- 🎯 **Strict Type Safety**: Fully inferred parameter and return types for RPC methods.
- 🔄 **Seamless Call Queuing**: Calls made while connecting or reconnecting are queued automatically and transmitted once connected.
- 🔁 **Auto-Reconnection**: Configurable retry logic (defaults to 3 retries) with automatic state recovery.
- ⚡ **Low-Latency Datagrams**: Unreliable topic-based messaging (`maxRetransmits: 0`) for real-time state updates (e.g. cursor positions, game loops).
- 🌐 **Cross-Environment WebRTC**: Uses native browser WebRTC when available and falls back to `werift` in Node.js / Bun.
- 🔌 **Pluggable Signaling**: Agnostic of signaling transport (WebSocket, WebSockets, broadcast channel, etc.).

---

## Installation

```bash
pnpm add light
# or
bun add light
```

---

## Quick Start

### 1. Define RPC Schemas

```ts
// Methods exposed by Peer A
export type PeerASchema = {
  getSystemInfo: () => { platform: string; uptime: number };
  calculateSum: (numbers: number[]) => number;
};

// Methods exposed by Peer B
export type PeerBSchema = {
  greetUser: (name: string) => string;
  processData: (input: { id: string; data: string }) => { processed: boolean; hash: string };
};
```

### 2. Instantiate and Connect Peers

#### Peer A (Initiator)

```ts
import { LightPeer } from 'light';
import type { PeerASchema, PeerBSchema } from './schema';

const peerA = new LightPeer<PeerASchema, PeerBSchema>({
  initiator: true,
  handlers: {
    getSystemInfo: () => ({ platform: process.platform, uptime: process.uptime() }),
    calculateSum: (numbers) => numbers.reduce((a, b) => a + b, 0),
  },
  autoReconnect: true,
  maxRetries: 3,
});

// Relay signaling data over your preferred signaling channel (e.g. WebSocket)
peerA.on('signal', (signal) => {
  signalingChannel.send({ to: 'peer-b', signal });
});

// Initiate connection
await peerA.connect();
```

#### Peer B (Receiver)

```ts
import { LightPeer } from 'light';
import type { PeerASchema, PeerBSchema } from './schema';

const peerB = new LightPeer<PeerBSchema, PeerASchema>({
  initiator: false,
  handlers: {
    greetUser: (name) => `Hello, ${name}!`,
    processData: (input) => ({ processed: true, hash: `hash_${input.id}` }),
  },
});

peerB.on('signal', (signal) => {
  signalingChannel.send({ to: 'peer-a', signal });
});

// Handle incoming signals from Peer A
signalingChannel.on('message', (data) => {
  peerB.handleSignal(data.signal);
});
```

---

## Usage Guide

### Making Typed RPC Calls

You can call remote methods directly. If the peer is still connecting or reconnecting, the call will be **queued automatically** and resolved once connection completes.

```ts
// Call Peer B's greetUser method from Peer A
const greeting = await peerA.call('greetUser', 'Alice');
console.log(greeting); // "Hello, Alice!"

// Type errors caught at compile-time!
// @ts-expect-error Invalid argument type
await peerA.call('greetUser', 123);
```

### Unreliable Datagrams

For high-frequency or non-critical state updates, use datagrams.

```ts
// Subscribe to a topic
peerB.onDatagram('player_move', (payload, timestamp) => {
  console.log('Player moved to:', payload.x, payload.y);
});

// Send an unreliable datagram
peerA.sendDatagram('player_move', { x: 100, y: 250 });
```

### Event Handling

```ts
peer.on('connectionStateChange', (state) => {
  console.log('Connection state:', state); // 'connecting' | 'connected' | 'failed' | 'closed'
});

peer.on('reconnecting', (attempt) => {
  console.warn(`Reconnecting attempt ${attempt}/3...`);
});

peer.on('reconnectFailed', () => {
  console.error('Failed to reconnect after maximum retries.');
});

peer.on('ready', () => {
  console.log('Data channels are open and ready for RPC calls.');
});
```

---

## Running Included Examples

### 1. Interactive CLI Clients

Start the unified server, then run CLI client instances in separate terminal windows:

```bash
# Start unified web & signaling server
bun run example:web

# Terminal 1:
bun run example:cli cli-1 cli-2 true

# Terminal 2:
bun run example:cli cli-2 cli-1 false
```

Inside the CLI REPL:
- `call ping`
- `call add 10 20`
- `call echo "Hello"`
- `datagram chat "Hey peer!"`

### 2. Browser Client Example

```bash
bun run example:web
```

Open `http://localhost:3000` in two browser tabs to interactively test WebRTC RPC calls, datagrams, and event logs.

---

## Development & Testing

```bash
# Install dependencies
pnpm install

# Run typecheck & build
pnpm run build

# Run unit tests
pnpm run test
```

---

## License

MIT
