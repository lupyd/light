import path from 'node:path';
import { getDummySSLCertificate } from '../ssl';

const USE_SSL = process.env.USE_SSL === 'true';
const PORT = Number(process.env.PORT) || Number(process.env.WEB_PORT) || 3000;

let certs: any = null;
if (USE_SSL) {
  certs = await getDummySSLCertificate();
}

// Client registration map for WebSocket signaling
const clients = new Map<string, any>();

// Pre-build client JavaScript bundle
let compiledJs = '';

async function buildClient() {
  try {
    const result = await Bun.build({
      entrypoints: [path.join(import.meta.dirname, 'client.ts')],
      target: 'browser',
    });
    if (result.success && result.outputs.length > 0) {
      compiledJs = await result.outputs[0].text();
    }
  } catch (e) {
    console.error('Failed to bundle client.ts:', e);
  }
}

await buildClient();

const protocol = USE_SSL ? 'https' : 'http';
const wsProtocol = USE_SSL ? 'wss' : 'ws';

const serveOptions: any = {
  port: PORT,
  fetch(req: Request, server: any) {
    const url = new URL(req.url);

    // 1. Handle WebSocket Upgrade for WebRTC Signaling on the same port
    if (url.pathname === '/ws' || req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const success = server.upgrade(req, {
        data: { clientId: null },
      });
      if (success) return undefined;
    }

    // 2. Serve HTML Web Page
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return Bun.file(path.join(import.meta.dirname, 'index.html')).text().then((html) => {
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      });
    }

    // 3. Serve Client Bundle JS
    if (url.pathname === '/client.js') {
      return buildClient().then(() => {
        return new Response(compiledJs, {
          headers: { 'Content-Type': 'application/javascript' },
        });
      });
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket: {
    open(ws: any) {
      console.log('[Signaling Server] New WebSocket client connected.');
    },
    message(ws: any, message: string | Buffer) {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === 'register') {
          ws.data.clientId = data.id;
          clients.set(data.id, ws);
          console.log(`[Signaling Server] Client '${data.id}' registered.`);
          ws.send(JSON.stringify({ type: 'registered', id: data.id }));
          return;
        }

        if (data.type === 'signal' && data.to) {
          const recipientWs = clients.get(data.to);
          if (recipientWs) {
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
    },
    close(ws: any) {
      const clientId = ws.data?.clientId;
      if (clientId) {
        clients.delete(clientId);
        console.log(`[Signaling Server] Client '${clientId}' disconnected.`);
      }
    },
  },
};

if (USE_SSL && certs) {
  serveOptions.tls = {
    cert: certs.cert,
    key: certs.key,
  };
}

Bun.serve(serveOptions);

console.log(`\n======================================================`);
console.log(`🚀 Unified Web & Signaling Server Running!`);
console.log(`🌐 Website URL: ${protocol}://localhost:${PORT}/`);
console.log(`📡 Signaling URL: ${wsProtocol}://localhost:${PORT}/ws`);
console.log(`👉 Open ${protocol}://localhost:${PORT}/ in browser tabs or pair with CLI client!`);
console.log(`======================================================\n`);
