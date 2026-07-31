import http from 'node:http';
import https from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import { getDummySSLCertificate } from './ssl.js';

const USE_SSL = process.env.USE_SSL === 'true';
const PORT = Number(process.env.PORT) || 8099;

let server: any;

if (USE_SSL) {
  const certs = await getDummySSLCertificate();
  server = https.createServer(
    {
      cert: certs.cert,
      key: certs.key,
    },
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Light WebRTC Signaling Server is Running (WSS)\n');
    }
  );
  console.log(`📡 Secure WSS Signaling Server running on wss://localhost:${PORT}`);
} else {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Light WebRTC Signaling Server is Running (WS)\n');
  });
  console.log(`📡 WebSocket Signaling Server running on ws://localhost:${PORT}`);
}

const wss = new WebSocketServer({ server });
const clients = new Map<string, WebSocket>();

server.listen(PORT);

wss.on('connection', (ws) => {
  let clientId: string | null = null;

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'register') {
        clientId = data.id;
        clients.set(clientId!, ws);
        console.log(`[Signaling Server] Client '${clientId}' registered.`);

        ws.send(JSON.stringify({ type: 'registered', id: clientId }));
        return;
      }

      if (data.type === 'signal' && data.to) {
        const recipientWs = clients.get(data.to);
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
          console.log(`[Signaling Server] Relaying signal from '${data.from}' to '${data.to}' (${data.signal.type})`);
          recipientWs.send(
            JSON.stringify({
              type: 'signal',
              from: data.from,
              signal: data.signal,
            })
          );
        } else {
          console.warn(`[Signaling Server] Recipient '${data.to}' not connected.`);
        }
      }
    } catch (err) {
      console.error('[Signaling Server] Error processing message:', err);
    }
  });

  ws.on('close', () => {
    if (clientId) {
      clients.delete(clientId);
      console.log(`[Signaling Server] Client '${clientId}' disconnected.`);
    }
  });
});
