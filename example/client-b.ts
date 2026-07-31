import WebSocket from 'ws';
import { LightPeer } from '../src/index';
import type { ClientASchema, ClientBSchema } from './schema';
import { allowSelfSignedCertificates } from './ssl';

allowSelfSignedCertificates();

const SIGNALING_URL = process.env.SIGNALING_URL || 'ws://localhost:3000/ws';
const MY_ID = 'client-b';
const PEER_ID = 'client-a';

console.log(`[Client B] Connecting to signaling server at ${SIGNALING_URL}...`);
const ws = new WebSocket(SIGNALING_URL, { rejectUnauthorized: false });

// Implement local methods that Client A can call on Client B
const localHandlers: ClientBSchema = {
  greetUser: (name: string) => `Hello ${name}, greetings from Client B!`,
  processData: (input) => ({
    processed: true,
    hash: `hash_${input.id}_${input.data.length}_${Date.now()}`,
  }),
  ping: () => 'pong',
};

const peer = new LightPeer<ClientBSchema, ClientASchema>({
  initiator: false, // Client B waits for offer from Client A
  handlers: localHandlers,
});

ws.on('open', () => {
  console.log('[Client B] Connected to signaling server, registering ID...');
  ws.send(JSON.stringify({ type: 'register', id: MY_ID }));
});

ws.on('message', async (data: string) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'registered') {
    console.log('[Client B] Registered. Waiting for incoming WebRTC offer...');
  } else if (msg.type === 'signal' && msg.from === PEER_ID) {
    console.log(`[Client B] Received signal from ${PEER_ID}`);
    await peer.handleSignal(msg.signal);
  }
});

// Forward WebRTC signals from LightPeer to Client A via WebSocket
peer.on('signal', (signal) => {
  console.log(`[Client B] Sending WebRTC signal [${signal.type}] to ${PEER_ID}`);
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
  console.log(`[Client B] WebRTC Connection State: ${state}`);
});

peer.onDatagram('mouse_move', (payload) => {
  console.log(`[Client B] Received datagram 'mouse_move' from A:`, payload);
});

// Run demo once connected
peer.on('ready', async () => {
  console.log('\n✅ [Client B] WebRTC Data Channels Ready!\n');

  try {
    // 1. Call Client A's getSystemInfo method
    console.log('[Client B] Calling remote method A: getSystemInfo()...');
    const info = await peer.call('getSystemInfo');
    console.log('[Client B] Response from A:', info);

    // 2. Call Client A's calculateSum method
    console.log('[Client B] Calling remote method A: calculateSum([10, 20, 30, 40])...');
    const sum = await peer.call('calculateSum', [10, 20, 30, 40]);
    console.log('[Client B] Response from A:', sum);

    // 3. Send unreliable datagram
    console.log('[Client B] Sending datagram "status_update" to A...');
    peer.sendDatagram('status_update', { progress: 100, status: 'complete' });

    // Exit example after 2 seconds
    setTimeout(() => {
      console.log('\n🎉 Example completed successfully! Closing peers.');
      peer.close();
      ws.close();
      process.exit(0);
    }, 2000);

  } catch (err) {
    console.error('[Client B] RPC Error:', err);
  }
});
