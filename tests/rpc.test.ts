import { describe, expect, it } from 'bun:test';
import {
  LightPeer,
  MaxRetriesExceededError,
  MethodNotFoundError,
  RpcExecutionError,
  RpcTimeoutError,
} from '../src/index';

// Define schemas for two peers
type PeerASchema = {
  add: (a: number, b: number) => number;
  greet: (name: string) => string;
  fail: () => void;
  delayed: (ms: number) => string;
};

type PeerBSchema = {
  multiply: (a: number, b: number) => number;
  ping: () => string;
};

function setupConnectedPeers(
  aHandlers: PeerASchema,
  bHandlers: PeerBSchema,
  aOptions: { rpcTimeout?: number } = {},
  bOptions: { rpcTimeout?: number } = {}
): { peerA: LightPeer<PeerASchema, PeerBSchema>; peerB: LightPeer<PeerBSchema, PeerASchema> } {
  const peerA = new LightPeer<PeerASchema, PeerBSchema>({
    initiator: true,
    handlers: aHandlers,
    ...aOptions,
  });

  const peerB = new LightPeer<PeerBSchema, PeerASchema>({
    initiator: false,
    handlers: bHandlers,
    ...bOptions,
  });

  // Exchange signals directly
  peerA.on('signal', (signal) => peerB.handleSignal(signal));
  peerB.on('signal', (signal) => peerA.handleSignal(signal));

  return { peerA, peerB };
}

describe('LightPeer WebRTC RPC & Datagrams', () => {
  it('should connect two peers and execute RPC calls in both directions', async () => {
    const peerAHandlers: PeerASchema = {
      add: (a, b) => a + b,
      greet: (name) => `Hello, ${name}!`,
      fail: () => {
        throw new Error('Handler deliberately failed');
      },
      delayed: async (ms) => {
        await new Promise((r) => setTimeout(r, ms));
        return 'done';
      },
    };

    const peerBHandlers: PeerBSchema = {
      multiply: (a, b) => a * b,
      ping: () => 'pong',
    };

    const { peerA, peerB } = setupConnectedPeers(peerAHandlers, peerBHandlers);

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    expect(peerA.isReady).toBe(true);
    expect(peerB.isReady).toBe(true);

    // Call Peer B methods from Peer A
    const multResult = await peerA.call('multiply', 6, 7);
    expect(multResult).toBe(42);

    const pingResult = await peerA.call('ping');
    expect(pingResult).toBe('pong');

    // Call Peer A methods from Peer B
    const addResult = await peerB.call('add', 10, 25);
    expect(addResult).toBe(35);

    const greetResult = await peerB.call('greet', 'Alice');
    expect(greetResult).toBe('Hello, Alice!');

    peerA.close();
    peerB.close();
  });

  it('should queue RPC calls before connecting and flush them upon connection', async () => {
    const peerA = new LightPeer<PeerASchema, PeerBSchema>({
      initiator: true,
      handlers: {
        add: (a, b) => a + b,
        greet: (n) => `Hello ${n}`,
        fail: () => {},
        delayed: () => '',
      },
    });

    const peerB = new LightPeer<PeerBSchema, PeerASchema>({
      initiator: false,
      handlers: {
        multiply: (a, b) => a * b,
        ping: () => 'pong',
      },
    });

    // Wire up signaling
    peerA.on('signal', (signal) => peerB.handleSignal(signal));
    peerB.on('signal', (signal) => peerA.handleSignal(signal));

    // Call methods BEFORE connecting or calling waitUntilReady
    const multiplyPromise = peerA.call('multiply', 5, 5);
    const pingPromise = peerA.call('ping');
    const addPromise = peerB.call('add', 100, 200);

    // Now initiate connection
    await peerA.connect();

    // Await all queued promises
    const [multRes, pingRes, addRes] = await Promise.all([multiplyPromise, pingPromise, addPromise]);

    expect(multRes).toBe(25);
    expect(pingRes).toBe('pong');
    expect(addRes).toBe(300);

    peerA.close();
    peerB.close();
  });

  it('should attempt reconnect and succeed after unexpected disconnect', async () => {
    const peerA = new LightPeer<PeerASchema, PeerBSchema>({
      initiator: true,
      handlers: { add: (a, b) => a + b, greet: (n) => n, fail: () => {}, delayed: () => '' },
      autoReconnect: true,
      reconnectDelay: 50,
      maxRetries: 3,
    });

    const peerB = new LightPeer<PeerBSchema, PeerASchema>({
      initiator: false,
      handlers: { multiply: (a, b) => a * b, ping: () => 'pong' },
      autoReconnect: true,
      reconnectDelay: 50,
      maxRetries: 3,
    });

    peerA.on('signal', (s) => peerB.handleSignal(s));
    peerB.on('signal', (s) => peerA.handleSignal(s));

    let reconnectAttempts = 0;
    peerA.on('reconnecting', (attempt) => {
      reconnectAttempts = attempt;
    });

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    expect(peerA.isReady).toBe(true);

    // Trigger disconnect by calling handleDisconnect on peerA
    (peerA as any).handleDisconnect();

    expect(reconnectAttempts).toBe(1);

    // Make an RPC call while reconnecting - it should queue up!
    const callPromise = peerA.call('multiply', 3, 4);

    // Wait for reconnection to complete
    await peerA.waitUntilReady();

    const res = await callPromise;
    expect(res).toBe(12);

    peerA.close();
    peerB.close();
  });

  it('should retry 3 times and call it quits when reconnection fails', async () => {
    const peerA = new LightPeer<PeerASchema, PeerBSchema>({
      initiator: true,
      handlers: { add: (a, b) => a + b, greet: (n) => n, fail: () => {}, delayed: () => '' },
      autoReconnect: true,
      reconnectDelay: 20,
      reconnectTimeout: 50,
      maxRetries: 3,
    });

    peerA.on('error', () => {});

    let reconnectingEvents: number[] = [];
    peerA.on('reconnecting', (attempt) => {
      reconnectingEvents.push(attempt);
    });

    let reconnectFailedFired = false;
    peerA.on('reconnectFailed', () => {
      reconnectFailedFired = true;
    });

    // Make an RPC call without any receiver peer connected
    const callPromise = peerA.call('multiply', 10, 10);

    // Trigger disconnect
    (peerA as any).handleDisconnect();

    try {
      await callPromise;
      expect().fail('Should have rejected with MaxRetriesExceededError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(MaxRetriesExceededError);
      expect(err.message).toContain('3');
    }

    expect(reconnectingEvents).toEqual([1, 2, 3]);
    expect(reconnectFailedFired).toBe(true);

    peerA.close();
  });

  it('should handle remote execution errors', async () => {
    const { peerA, peerB } = setupConnectedPeers(
      {
        add: (a, b) => a + b,
        greet: (n) => n,
        fail: () => {
          throw new Error('Something went wrong on server');
        },
        delayed: (ms) => 'ok',
      },
      {
        multiply: (a, b) => a * b,
        ping: () => 'pong',
      }
    );

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    try {
      await peerB.call('fail');
      expect().fail('Should have thrown RpcExecutionError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcExecutionError);
      expect(err.message).toContain('Something went wrong on server');
    }

    peerA.close();
    peerB.close();
  });

  it('should throw MethodNotFoundError for unknown RPC methods', async () => {
    const { peerA, peerB } = setupConnectedPeers(
      {
        add: (a, b) => a + b,
        greet: (n) => n,
        fail: () => {},
        delayed: (ms) => 'ok',
      },
      {
        multiply: (a, b) => a * b,
        ping: () => 'pong',
      }
    );

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    try {
      // @ts-expect-error Calling unhandled method for test
      await peerA.call('nonExistentMethod');
      expect().fail('Should have thrown MethodNotFoundError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(MethodNotFoundError);
      expect(err.message).toContain('nonExistentMethod');
    }

    peerA.close();
    peerB.close();
  });

  it('should timeout if method takes too long', async () => {
    const { peerA, peerB } = setupConnectedPeers(
      {
        add: (a, b) => a + b,
        greet: (n) => n,
        fail: () => {},
        delayed: async (ms) => {
          await new Promise((r) => setTimeout(r, ms));
          return 'done';
        },
      },
      {
        multiply: (a, b) => a * b,
        ping: () => 'pong',
      },
      {},
      { rpcTimeout: 100 } // Set 100ms timeout on peerB
    );

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    try {
      await peerB.call('delayed', 500); // Wait 500ms when timeout is 100ms
      expect().fail('Should have timed out');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcTimeoutError);
      expect(err.message).toContain('timed out');
    }

    peerA.close();
    peerB.close();
  });

  it('should send and receive datagrams', async () => {
    const { peerA, peerB } = setupConnectedPeers(
      { add: (a, b) => a + b, greet: (n) => n, fail: () => {}, delayed: () => '' },
      { multiply: (a, b) => a * b, ping: () => 'pong' }
    );

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    // Small delay to ensure both data channels (RPC and Datagram) are fully ready
    await new Promise((r) => setTimeout(r, 200));

    const receivedDatagrams: any[] = [];
    peerB.onDatagram('player_move', (payload) => {
      receivedDatagrams.push(payload);
    });

    peerA.sendDatagram('player_move', { x: 10, y: 20 });
    peerA.sendDatagram('player_move', { x: 15, y: 25 });

    // Give time for datagram messages to be received
    await new Promise((r) => setTimeout(r, 300));

    expect(receivedDatagrams.length).toBe(2);
    expect(receivedDatagrams[0]).toEqual({ x: 10, y: 20 });
    expect(receivedDatagrams[1]).toEqual({ x: 15, y: 25 });

    peerA.close();
    peerB.close();
  });
});
