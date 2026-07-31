import { describe, expect, it } from 'bun:test';
import {
  LightPeer,
  MaxRetriesExceededError,
  MethodNotFoundError,
  RpcExecutionError,
  RpcTimeoutError,
} from '../src/index';

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

const encodeJson = (val: any) => textEnc.encode(JSON.stringify(val ?? null));
const decodeJson = (bytes: Uint8Array) => JSON.parse(textDec.decode(bytes));

// Define 1-argument binary schemas for two peers
type PeerASchema = {
  add: (data: Uint8Array) => Uint8Array;
  greet: (data: Uint8Array) => Uint8Array;
  fail: (data: Uint8Array) => Uint8Array;
  delayed: (data: Uint8Array) => Promise<Uint8Array>;
};

type PeerBSchema = {
  multiply: (data: Uint8Array) => Uint8Array;
  ping: (data: Uint8Array) => Uint8Array;
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

  peerA.on('signal', (signal) => peerB.handleSignal(signal));
  peerB.on('signal', (signal) => peerA.handleSignal(signal));

  return { peerA, peerB };
}

describe('LightPeer WebRTC Binary RPC & Datagrams', () => {
  it('should connect two peers and execute binary RPC calls in both directions', async () => {
    const peerAHandlers: PeerASchema = {
      add: (data) => {
        const [a, b] = decodeJson(data);
        return encodeJson(a + b);
      },
      greet: (data) => {
        const name = decodeJson(data);
        return encodeJson(`Hello, ${name}!`);
      },
      fail: () => {
        throw new Error('Handler deliberately failed');
      },
      delayed: async (data) => {
        const ms = decodeJson(data);
        await new Promise((r) => setTimeout(r, ms));
        return encodeJson('done');
      },
    };

    const peerBHandlers: PeerBSchema = {
      multiply: (data) => {
        const [a, b] = decodeJson(data);
        return encodeJson(a * b);
      },
      ping: () => encodeJson('pong'),
    };

    const { peerA, peerB } = setupConnectedPeers(peerAHandlers, peerBHandlers);

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    expect(peerA.isReady).toBe(true);
    expect(peerB.isReady).toBe(true);

    // Call Peer B methods from Peer A with binary argument
    const multResult = await peerA.call('multiply', encodeJson([6, 7]));
    expect(decodeJson(multResult)).toBe(42);

    const pingResult = await peerA.call('ping', new Uint8Array(0));
    expect(decodeJson(pingResult)).toBe('pong');

    // Call Peer A methods from Peer B
    const addResult = await peerB.call('add', encodeJson([10, 25]));
    expect(decodeJson(addResult)).toBe(35);

    const greetResult = await peerB.call('greet', encodeJson('Alice'));
    expect(decodeJson(greetResult)).toBe('Hello, Alice!');

    peerA.close();
    peerB.close();
  });

  it('should support raw binary Uint8Array payloads for RPC calls and Datagrams', async () => {
    type BinaryASchema = {
      echoBinary: (data: Uint8Array) => Uint8Array;
    };
    type BinaryBSchema = {};

    const peerA = new LightPeer<BinaryASchema, BinaryBSchema>({
      initiator: true,
      handlers: {
        echoBinary: (data: Uint8Array) => {
          expect(data).toBeInstanceOf(Uint8Array);
          const response = new Uint8Array(data.length);
          for (let i = 0; i < data.length; i++) {
            response[i] = data[i] + 1;
          }
          return response;
        },
      },
    });

    const peerB = new LightPeer<BinaryBSchema, BinaryASchema>({
      initiator: false,
    });

    peerA.on('signal', (s) => peerB.handleSignal(s));
    peerB.on('signal', (s) => peerA.handleSignal(s));

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    const input = new Uint8Array([10, 20, 30, 40]);
    const output = await peerB.call('echoBinary', input);

    expect(output).toBeInstanceOf(Uint8Array);
    expect(Array.from(output)).toEqual([11, 21, 31, 41]);

    let receivedBinaryDatagram: Uint8Array | null = null;
    peerB.onDatagram('binary_topic', (payload) => {
      receivedBinaryDatagram = payload;
    });

    const datagramBytes = new Uint8Array([255, 254, 253]);
    peerA.sendDatagram('binary_topic', datagramBytes);

    await new Promise((r) => setTimeout(r, 200));

    expect(receivedBinaryDatagram).toBeInstanceOf(Uint8Array);
    expect(Array.from(receivedBinaryDatagram!)).toEqual([255, 254, 253]);

    peerA.close();
    peerB.close();
  });

  it('should queue RPC calls before connecting and flush them upon connection', async () => {
    const peerA = new LightPeer<PeerASchema, PeerBSchema>({
      initiator: true,
      handlers: {
        add: (data) => encodeJson(decodeJson(data)[0] + decodeJson(data)[1]),
        greet: (data) => encodeJson(`Hello ${decodeJson(data)}`),
        fail: () => encodeJson(null),
        delayed: () => Promise.resolve(encodeJson('')),
      },
    });

    const peerB = new LightPeer<PeerBSchema, PeerASchema>({
      initiator: false,
      handlers: {
        multiply: (data) => encodeJson(decodeJson(data)[0] * decodeJson(data)[1]),
        ping: () => encodeJson('pong'),
      },
    });

    peerA.on('signal', (signal) => peerB.handleSignal(signal));
    peerB.on('signal', (signal) => peerA.handleSignal(signal));

    const multiplyPromise = peerA.call('multiply', encodeJson([5, 5]));
    const pingPromise = peerA.call('ping', new Uint8Array(0));
    const addPromise = peerB.call('add', encodeJson([100, 200]));

    await peerA.connect();

    const [multRes, pingRes, addRes] = await Promise.all([multiplyPromise, pingPromise, addPromise]);

    expect(decodeJson(multRes)).toBe(25);
    expect(decodeJson(pingRes)).toBe('pong');
    expect(decodeJson(addRes)).toBe(300);

    peerA.close();
    peerB.close();
  });

  it('should attempt reconnect and succeed after unexpected disconnect', async () => {
    const peerA = new LightPeer<PeerASchema, PeerBSchema>({
      initiator: true,
      handlers: {
        add: (d) => encodeJson(0),
        greet: (d) => encodeJson(''),
        fail: () => encodeJson(null),
        delayed: () => Promise.resolve(encodeJson('')),
      },
      autoReconnect: true,
      reconnectDelay: 50,
      maxRetries: 3,
    });

    const peerB = new LightPeer<PeerBSchema, PeerASchema>({
      initiator: false,
      handlers: {
        multiply: (data) => encodeJson(decodeJson(data)[0] * decodeJson(data)[1]),
        ping: () => encodeJson('pong'),
      },
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

    (peerA as any).handleDisconnect();

    expect(reconnectAttempts).toBe(1);

    const callPromise = peerA.call('multiply', encodeJson([3, 4]));

    await peerA.waitUntilReady();

    const res = await callPromise;
    expect(decodeJson(res)).toBe(12);

    peerA.close();
    peerB.close();
  });

  it('should retry 3 times and call it quits when reconnection fails', async () => {
    const peerA = new LightPeer<PeerASchema, PeerBSchema>({
      initiator: true,
      handlers: {
        add: (d) => encodeJson(0),
        greet: (d) => encodeJson(''),
        fail: () => encodeJson(null),
        delayed: () => Promise.resolve(encodeJson('')),
      },
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

    const callPromise = peerA.call('multiply', encodeJson([10, 10]));

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
        add: () => encodeJson(0),
        greet: () => encodeJson(''),
        fail: () => {
          throw new Error('Something went wrong on server');
        },
        delayed: () => Promise.resolve(encodeJson('')),
      },
      {
        multiply: () => encodeJson(0),
        ping: () => encodeJson('pong'),
      }
    );

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    try {
      await peerB.call('fail', new Uint8Array(0));
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
        add: () => encodeJson(0),
        greet: () => encodeJson(''),
        fail: () => encodeJson(null),
        delayed: () => Promise.resolve(encodeJson('')),
      },
      {
        multiply: () => encodeJson(0),
        ping: () => encodeJson('pong'),
      }
    );

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    try {
      // @ts-expect-error Calling unhandled method for test
      await peerA.call('nonExistentMethod', new Uint8Array(0));
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
        add: () => encodeJson(0),
        greet: () => encodeJson(''),
        fail: () => encodeJson(null),
        delayed: async (data) => {
          const ms = decodeJson(data);
          await new Promise((r) => setTimeout(r, ms));
          return encodeJson('done');
        },
      },
      {
        multiply: () => encodeJson(0),
        ping: () => encodeJson('pong'),
      },
      {},
      { rpcTimeout: 100 }
    );

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    try {
      await peerB.call('delayed', encodeJson(500));
      expect().fail('Should have timed out');
    } catch (err: any) {
      expect(err).toBeInstanceOf(RpcTimeoutError);
      expect(err.message).toContain('timed out');
    }

    peerA.close();
    peerB.close();
  });

  it('should send and receive binary datagrams', async () => {
    const { peerA, peerB } = setupConnectedPeers(
      { add: () => encodeJson(0), greet: () => encodeJson(''), fail: () => encodeJson(null), delayed: () => Promise.resolve(encodeJson('')) },
      { multiply: () => encodeJson(0), ping: () => encodeJson('pong') }
    );

    await peerA.connect();
    await Promise.all([peerA.waitUntilReady(), peerB.waitUntilReady()]);

    await new Promise((r) => setTimeout(r, 200));

    const receivedDatagrams: any[] = [];
    peerB.onDatagram('player_move', (payload) => {
      receivedDatagrams.push(decodeJson(payload));
    });

    peerA.sendDatagram('player_move', encodeJson({ x: 10, y: 20 }));
    peerA.sendDatagram('player_move', encodeJson({ x: 15, y: 25 }));

    await new Promise((r) => setTimeout(r, 300));

    expect(receivedDatagrams.length).toBe(2);
    expect(receivedDatagrams[0]).toEqual({ x: 10, y: 20 });
    expect(receivedDatagrams[1]).toEqual({ x: 15, y: 25 });

    peerA.close();
    peerB.close();
  });
});
