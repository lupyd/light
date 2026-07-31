import WebSocket from 'ws';
import { LightPeer } from '../src/index';
import { decodeJson, encodeJson, type ClientASchema, type ClientBSchema } from './schema';
import { allowSelfSignedCertificates } from './ssl';

allowSelfSignedCertificates();

const SIGNALING_URL = process.env.SIGNALING_URL || 'ws://localhost:3000/ws';
const MY_ID = 'client-a';
const PEER_ID = 'client-b';

console.log(`[Client A] Connecting to signaling server at ${SIGNALING_URL}...`);
const ws = new WebSocket(SIGNALING_URL, { rejectUnauthorized: false });

// Local binary handlers
const localHandlers: ClientASchema = {
  getSystemInfo: () =>
    encodeJson({
      platform: process.platform,
      uptime: Math.round(process.uptime()),
    }),
  calculateSum: (data) => {
    const numbers: number[] = decodeJson(data);
    return encodeJson(numbers.reduce((acc, curr) => acc + curr, 0));
  },
  echo: (data) => {
    const msg: string = decodeJson(data);
    return encodeJson(`Echo: ${msg}`);
  },
};

const peer = new LightPeer<ClientASchema, ClientBSchema>({
  initiator: true,
  handlers: localHandlers,
});

ws.on('open', () => {
  console.log('[Client A] Connected to signaling server, registering ID...');
  ws.send(JSON.stringify({ type: 'register', id: MY_ID }));
});

ws.on('message', async (data: string) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'registered') {
    console.log('[Client A] Successfully registered. Initiating WebRTC peer connection...');
    await peer.connect();
  } else if (msg.type === 'signal' && msg.from === PEER_ID) {
    console.log(`[Client A] Received signal from ${PEER_ID}`);
    await peer.handleSignal(msg.signal);
  }
});

peer.on('signal', (signal) => {
  console.log(`[Client A] Sending WebRTC signal [${signal.type}] to ${PEER_ID}`);
  ws.send(
    JSON.stringify({
      type: 'signal',
      from: MY_ID,
      to: PEER_ID,
      signal,
    })
  );
});

peer.on('connectionStateChange', (state) => {
  console.log(`[Client A] WebRTC Connection State: ${state}`);
});

peer.onDatagram('status_update', (payload, timestamp) => {
  console.log(`[Client A] Received datagram 'status_update' from B:`, decodeJson(payload));
});

peer.on('ready', async () => {
  console.log('\n✅ [Client A] WebRTC Data Channels Ready!\n');

  try {
    console.log('[Client A] Calling remote method B: greetUser("Alice")...');
    const greetingRes = await peer.call('greetUser', encodeJson('Alice'));
    console.log('[Client A] Response from B:', decodeJson(greetingRes));

    console.log('[Client A] Calling remote method B: processData({ id: "item-101", data: "payload" })...');
    const resultRes = await peer.call('processData', encodeJson({ id: 'item-101', data: 'payload' }));
    console.log('[Client A] Response from B:', decodeJson(resultRes));

    console.log('[Client A] Sending datagram "mouse_move" to B...');
    peer.sendDatagram('mouse_move', encodeJson({ x: 120, y: 340, speed: 12.5 }));

    setTimeout(() => {
      console.log('✅ [Client A] Tasks completed cleanly.');
      peer.close();
      ws.close();
    }, 1500);

  } catch (err) {
    console.error('[Client A] RPC Error:', err);
  }
});
