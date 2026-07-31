import readline from 'node:readline';
import WebSocket from 'ws';
import { LightPeer } from '../src/index';
import { decodeJson, encodeJson, type CommonPeerSchema } from './schema';
import { allowSelfSignedCertificates } from './ssl';

allowSelfSignedCertificates();

const SIGNALING_URL = process.env.SIGNALING_URL || 'ws://localhost:3000/ws';

const args = process.argv.slice(2);
const MY_ID = args[0] || 'cli-1';
const PEER_ID = args[1] || 'cli-2';
const IS_INITIATOR = args[2] === 'true' || args[0] === 'cli-1' || !args[0];

console.log(`\n======================================================`);
console.log(`🚀 Light WebRTC Binary RPC CLI Client`);
console.log(`🆔 ID: '${MY_ID}' | Target Peer: '${PEER_ID}' | Initiator: ${IS_INITIATOR}`);
console.log(`======================================================\n`);

// Local binary handlers
const localHandlers: CommonPeerSchema = {
  ping: () => encodeJson('pong from ' + MY_ID),
  echo: (data) => encodeJson(`[${MY_ID}] Echo: ${decodeJson(data)}`),
  add: (data) => {
    const [a, b] = decodeJson<[number, number]>(data);
    return encodeJson(Number(a) + Number(b));
  },
  getSystemInfo: () =>
    encodeJson({
      platform: process.platform,
      uptime: Math.round(process.uptime()),
      timestamp: Date.now(),
    }),
  fetchQuote: () => {
    const quotes = [
      { quote: 'Simplicity is prerequisite for reliability.', author: 'Edsger W. Dijkstra' },
      { quote: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
      { quote: 'Code is like humor. When you have to explain it, it\'s bad.', author: 'Cory House' },
    ];
    return encodeJson(quotes[Math.floor(Math.random() * quotes.length)]);
  },
};

const peer = new LightPeer<CommonPeerSchema, CommonPeerSchema>({
  initiator: IS_INITIATOR,
  handlers: localHandlers,
  autoReconnect: true,
  maxRetries: 3,
});

console.log(`[Signaling] Connecting to server at ${SIGNALING_URL}...`);
const ws = new WebSocket(SIGNALING_URL, { rejectUnauthorized: false });

ws.on('open', () => {
  console.log(`[Signaling] Connected. Registering ID '${MY_ID}'...`);
  ws.send(JSON.stringify({ type: 'register', id: MY_ID }));
});

ws.on('message', async (data: string) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'registered') {
    console.log(`[Signaling] Registered successfully.`);
    if (IS_INITIATOR) {
      console.log(`[WebRTC] Initiating WebRTC offer to '${PEER_ID}'...`);
      await peer.connect();
    } else {
      console.log(`[WebRTC] Waiting for incoming offer from '${PEER_ID}'...`);
    }
  } else if (msg.type === 'signal' && msg.from === PEER_ID) {
    console.log(`[Signaling] Received WebRTC signal '${msg.signal.type}' from '${PEER_ID}'`);
    await peer.handleSignal(msg.signal);
  }
});

peer.on('signal', (signal) => {
  console.log(`[Signaling] Sending WebRTC signal '${signal.type}' to '${PEER_ID}'`);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'signal',
        from: MY_ID,
        to: PEER_ID,
        signal,
      })
    );
  }
});

peer.on('connectionStateChange', (state) => {
  console.log(`\n⚡ [WebRTC] Connection state changed -> ${state}`);
});

peer.on('reconnecting', (attempt) => {
  console.warn(`⚠️ [WebRTC] Disconnected! Attempting auto-reconnect (${attempt}/3)...`);
});

peer.on('reconnectFailed', () => {
  console.error(`❌ [WebRTC] Auto-reconnect failed after maximum retries.`);
});

peer.on('ready', () => {
  console.log(`\n✅ [WebRTC] Data Channels READY! You can now make RPC calls.\n`);
});

peer.onDatagram('chat', (payload, timestamp) => {
  console.log(`\n📩 [Datagram: chat] ${decodeJson(payload)} (at ${new Date(timestamp).toLocaleTimeString()})`);
  rl.prompt();
});

peer.onDatagram('mouse_move', (payload) => {
  console.log(`\n🖱️ [Datagram: mouse_move]`, decodeJson(payload));
  rl.prompt();
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'light> ',
});

function showHelp() {
  console.log(`
Available commands:
  call <method> [arg1] [arg2]   Call an RPC method on remote peer
                                Methods: ping, echo, add, getSystemInfo, fetchQuote
                                Examples:
                                  call ping
                                  call add 15 25
                                  call echo "Hello peer!"
                                  call getSystemInfo
                                  call fetchQuote
  datagram <topic> <message>    Send an unreliable datagram to remote peer
                                Example: datagram chat "Hey there!"
  status                        Show WebRTC connection status
  methods                       List local exposed RPC methods
  connect                       Manually initiate WebRTC connection (if initiator)
  help                          Show this help menu
  exit                          Quit CLI
`);
}

setTimeout(() => {
  showHelp();
  rl.prompt();
}, 500);

rl.on('line', async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }

  const parts = input.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const cmd = parts[0]?.toLowerCase();

  switch (cmd) {
    case 'help':
      showHelp();
      break;

    case 'status':
      console.log(`
Connection State : ${peer.connectionState}
Is Ready         : ${peer.isReady}
Retry Count      : ${peer.currentRetryCount}
`);
      break;

    case 'methods':
      console.log(`
Exposed Local Methods:
  - ping(): string
  - echo(message: string): string
  - add(a: number, b: number): number
  - getSystemInfo(): { platform, uptime, timestamp }
  - fetchQuote(): { quote, author }
`);
      break;

    case 'connect':
      console.log(`[WebRTC] Initiating connection offer...`);
      await peer.connect();
      break;

    case 'call': {
      const method = parts[1];
      if (!method) {
        console.log('Usage: call <method> [arg1] [arg2]');
        break;
      }

      const rawArgs = parts.slice(2).map((a) => a.replace(/^"|"$/g, ''));
      let payload: Uint8Array = new Uint8Array(0);

      if (method === 'add') {
        payload = encodeJson([Number(rawArgs[0] || 0), Number(rawArgs[1] || 0)]);
      } else if (method === 'echo') {
        payload = encodeJson(rawArgs.join(' '));
      } else if (rawArgs.length > 0) {
        payload = encodeJson(rawArgs[0]);
      }

      console.log(`⏳ Calling '${method}' on '${PEER_ID}'...`);
      try {
        const resultBytes = await peer.call(method as any, payload);
        console.log(`✨ Result from '${PEER_ID}':`, decodeJson(resultBytes));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ RPC Call Failed: ${msg}`);
      }
      break;
    }

    case 'datagram': {
      const topic = parts[1] || 'chat';
      const message = parts.slice(2).join(' ').replace(/^"|"$/g, '') || 'Hello';

      const sent = peer.sendDatagram(topic, encodeJson(message));
      console.log(sent ? `📤 Datagram sent to '${PEER_ID}' [${topic}]` : `❌ Failed to send datagram`);
      break;
    }

    case 'exit':
    case 'quit':
      console.log('👋 Goodbye!');
      peer.close();
      ws.close();
      process.exit(0);
      break;

    default:
      console.log(`Unknown command '${cmd}'. Type 'help' for available commands.`);
      break;
  }

  rl.prompt();
});
