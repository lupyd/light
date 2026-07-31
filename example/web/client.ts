import { LightPeer } from '../../src/index.js';
import type { CommonPeerSchema } from '../schema.js';

// DOM Elements
const statusBadge = document.getElementById('status-badge') as HTMLSpanElement;
const signalingUrlInput = document.getElementById('signaling-url') as HTMLInputElement;
const myIdInput = document.getElementById('my-id') as HTMLInputElement;
const targetIdInput = document.getElementById('target-id') as HTMLInputElement;
const isInitiatorInput = document.getElementById('is-initiator') as HTMLInputElement;

const btnConnect = document.getElementById('btn-connect') as HTMLButtonElement;
const btnDisconnect = document.getElementById('btn-disconnect') as HTMLButtonElement;

const rpcMethodSelect = document.getElementById('rpc-method') as HTMLSelectElement;
const rpcArgsInput = document.getElementById('rpc-args') as HTMLInputElement;
const btnCallRpc = document.getElementById('btn-call-rpc') as HTMLButtonElement;
const rpcResultPre = document.getElementById('rpc-result') as HTMLPreElement;

const datagramTopicInput = document.getElementById('datagram-topic') as HTMLInputElement;
const datagramPayloadInput = document.getElementById('datagram-payload') as HTMLInputElement;
const btnSendDatagram = document.getElementById('btn-send-datagram') as HTMLButtonElement;

const consoleLog = document.getElementById('console-log') as HTMLDivElement;

let peer: LightPeer<CommonPeerSchema, CommonPeerSchema> | null = null;
let ws: WebSocket | null = null;

// Dynamically set signaling URL to match the website's host and protocol
if (signalingUrlInput) {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  signalingUrlInput.value = `${wsProtocol}//${window.location.host}/ws`;
}

function log(msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') {
  const line = document.createElement('div');
  line.className = `log-line log-${type}`;
  const timestamp = new Date().toLocaleTimeString();
  line.textContent = `[${timestamp}] ${msg}`;
  consoleLog.appendChild(line);
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

function updateStatus(state: string) {
  statusBadge.textContent = state.toUpperCase();
  statusBadge.className = `badge ${state}`;

  const isReady = peer ? peer.isReady : false;
  btnCallRpc.disabled = !isReady;
  btnSendDatagram.disabled = !isReady;
}

// Auto update default args based on selected method
rpcMethodSelect.addEventListener('change', () => {
  const method = rpcMethodSelect.value;
  if (method === 'ping' || method === 'getSystemInfo' || method === 'fetchQuote') {
    rpcArgsInput.value = '[]';
  } else if (method === 'echo') {
    rpcArgsInput.value = '["Hello from browser!"]';
  } else if (method === 'add') {
    rpcArgsInput.value = '[25, 75]';
  }
});

btnConnect.addEventListener('click', async () => {
  const signalingUrl = signalingUrlInput.value.trim();
  const myId = myIdInput.value.trim();
  const targetId = targetIdInput.value.trim();
  const isInitiator = isInitiatorInput.checked;

  if (!signalingUrl || !myId || !targetId) {
    alert('Please enter signaling URL, My ID, and Target ID.');
    return;
  }

  log(`Initializing peer '${myId}' targeting '${targetId}' (Initiator: ${isInitiator})...`, 'info');
  btnConnect.disabled = true;
  btnDisconnect.disabled = false;

  // Define local RPC handlers available to remote peer
  const localHandlers: CommonPeerSchema = {
    ping: () => 'pong from browser ' + myId,
    echo: (msg) => `[Browser ${myId}] Echo: ${msg}`,
    add: (a, b) => Number(a) + Number(b),
    getSystemInfo: () => ({
      platform: 'Browser (' + navigator.platform + ')',
      userAgent: navigator.userAgent,
      uptime: Math.round(performance.now() / 1000),
      timestamp: Date.now(),
    }),
    fetchQuote: () => ({
      quote: 'The web is a canvas for imagination.',
      author: 'Web Peer',
    }),
  };

  peer = new LightPeer<CommonPeerSchema, CommonPeerSchema>({
    initiator: isInitiator,
    handlers: localHandlers,
    autoReconnect: true,
    maxRetries: 3,
  });

  peer.on('connectionStateChange', (state) => {
    log(`WebRTC Connection state -> ${state}`, 'info');
    updateStatus(state);
  });

  peer.on('reconnecting', (attempt) => {
    log(`Disconnected! Auto-reconnecting attempt (${attempt}/3)...`, 'warn');
  });

  peer.on('reconnectFailed', () => {
    log(`Auto-reconnect failed after maximum attempts.`, 'error');
  });

  peer.on('ready', () => {
    log(`✅ WebRTC Data Channels READY! Peer connected.`, 'success');
    updateStatus('connected');
  });

  peer.onDatagram('chat', (payload, timestamp) => {
    log(`💬 [Datagram Received] Chat: ${JSON.stringify(payload)}`, 'success');
  });

  peer.onDatagram('mouse_move', (payload) => {
    log(`🖱️ [Datagram Received] Mouse: ${JSON.stringify(payload)}`, 'info');
  });

  // Connect to Signaling Server
  log(`Connecting to WebSocket signaling server: ${signalingUrl}...`, 'info');
  ws = new WebSocket(signalingUrl);

  ws.onopen = () => {
    log(`Connected to signaling server. Registering ID '${myId}'...`, 'info');
    ws!.send(JSON.stringify({ type: 'register', id: myId }));
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'registered') {
      log(`Registered on signaling server.`, 'success');
      if (isInitiator) {
        log(`Initiating WebRTC offer to '${targetId}'...`, 'info');
        await peer!.connect();
      } else {
        log(`Waiting for incoming WebRTC offer from '${targetId}'...`, 'info');
      }
    } else if (msg.type === 'signal' && msg.from === targetId) {
      log(`Received signal '${msg.signal.type}' from '${targetId}'`, 'info');
      await peer!.handleSignal(msg.signal);
    }
  };

  peer.on('signal', (signal) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      log(`Sending WebRTC signal '${signal.type}' to '${targetId}'`, 'info');
      ws.send(
        JSON.stringify({
          type: 'signal',
          from: myId,
          to: targetId,
          signal,
        })
      );
    }
  });

  ws.onclose = () => {
    log(`WebSocket signaling server connection closed.`, 'warn');
  };
});

btnDisconnect.addEventListener('click', () => {
  if (peer) {
    peer.close();
    peer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  btnConnect.disabled = false;
  btnDisconnect.disabled = true;
  updateStatus('disconnected');
  log(`Disconnected from peer and signaling server.`, 'warn');
});

btnCallRpc.addEventListener('click', async () => {
  if (!peer || !peer.isReady) {
    alert('Peer is not ready!');
    return;
  }

  const method = rpcMethodSelect.value;
  let args: any[] = [];
  try {
    args = JSON.parse(rpcArgsInput.value.trim() || '[]');
  } catch (e) {
    alert('Invalid JSON array for arguments!');
    return;
  }

  log(`Calling remote RPC method '${method}' with args: ${JSON.stringify(args)}...`, 'info');
  const startTime = performance.now();

  try {
    const result = await peer.call(method as any, ...args);
    const elapsed = Math.round(performance.now() - startTime);
    log(`✨ RPC Call '${method}' succeeded in ${elapsed}ms`, 'success');
    rpcResultPre.textContent = JSON.stringify(result, null, 2);
  } catch (err: any) {
    log(`❌ RPC Call '${method}' failed: ${err.message}`, 'error');
    rpcResultPre.textContent = `Error: ${err.message}`;
  }
});

btnSendDatagram.addEventListener('click', () => {
  if (!peer || !peer.isReady) {
    alert('Peer is not ready!');
    return;
  }

  const topic = datagramTopicInput.value.trim() || 'chat';
  let payload: any = datagramPayloadInput.value.trim();
  try {
    payload = JSON.parse(payload);
  } catch {
    // Treat as raw string if not JSON
  }

  const sent = peer.sendDatagram(topic, payload);
  if (sent) {
    log(`📤 Sent datagram [${topic}]: ${JSON.stringify(payload)}`, 'info');
  } else {
    log(`❌ Failed to send datagram`, 'error');
  }
});
