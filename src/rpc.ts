import {
  ConnectionClosedError,
  LightRPCError,
  MethodNotFoundError,
  RpcExecutionError,
  RpcTimeoutError,
} from './errors';
import {
  decodeRpcMessage,
  encodeRpcMessage,
  normalizeRawMessage,
  type ProtoRpcMessage,
  type ProtoRpcRequest,
  type ProtoRpcResponse,
} from './proto/protocol';
import type {
  InferRpcReturn,
  RpcSchema,
} from './types';

interface PendingRequest {
  resolve: (value: Uint8Array) => void;
  reject: (reason: Error | unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

interface QueuedRequest {
  id: string;
  method: string;
  payload: Uint8Array;
  resolve: (value: Uint8Array) => void;
  reject: (reason: Error | unknown) => void;
}

export class RpcEngine<
  TLocalSchema extends RpcSchema = RpcSchema,
  TRemoteSchema extends RpcSchema = RpcSchema
> {
  private handlers: Map<string, (data: Uint8Array) => Uint8Array | Promise<Uint8Array>> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private queuedRequests: QueuedRequest[] = [];
  private outboundResponsesQueue: ProtoRpcMessage[] = [];
  private channel: RTCDataChannel | null = null;
  private defaultTimeout: number;
  private isDestroyed = false;

  constructor(handlers?: Partial<TLocalSchema> | TLocalSchema, defaultTimeout = 10000) {
    this.defaultTimeout = defaultTimeout;
    if (handlers) {
      this.registerHandlers(handlers);
    }
  }

  /**
   * Set or update the active RTCDataChannel used for RPC communication.
   */
  public setChannel(channel: RTCDataChannel | null): void {
    this.channel = channel;
    if (this.channel) {
      try {
        this.channel.binaryType = 'arraybuffer';
      } catch {}
      if (this.channel.readyState === 'open') {
        this.flushQueue();
      }
    }
  }

  /**
   * Called when the RTCDataChannel opens.
   */
  public onChannelOpen(): void {
    if (this.channel) {
      try {
        this.channel.binaryType = 'arraybuffer';
      } catch {}
    }
    this.flushQueue();
  }

  /**
   * Called when the RTCDataChannel closes.
   */
  public onChannelClose(): void {
    this.channel = null;
  }

  /**
   * Flush and send all queued Protobuf RPC requests and responses over the open binary data channel.
   */
  public flushQueue(): void {
    if (!this.channel || this.channel.readyState !== 'open' || this.isDestroyed) {
      return;
    }

    const responses = [...this.outboundResponsesQueue];
    this.outboundResponsesQueue = [];
    for (const resp of responses) {
      this.sendRaw(resp);
    }

    const queue = [...this.queuedRequests];
    this.queuedRequests = [];

    for (const req of queue) {
      this.sendRequest(req.id, req.method, req.payload, req.resolve, req.reject);
    }
  }

  /**
   * Register local RPC handlers.
   */
  public registerHandlers(handlers: Partial<TLocalSchema> | TLocalSchema): void {
    for (const [method, handler] of Object.entries(handlers)) {
      if (typeof handler === 'function') {
        this.handlers.set(method, handler as (data: Uint8Array) => Uint8Array | Promise<Uint8Array>);
      }
    }
  }

  /**
   * Register a single local RPC handler.
   */
  public registerHandler<K extends keyof TLocalSchema>(
    method: K,
    handler: TLocalSchema[K]
  ): void {
    if (typeof handler === 'function') {
      this.handlers.set(method as string, handler as (data: Uint8Array) => Uint8Array | Promise<Uint8Array>);
    }
  }

  /**
   * Remove a registered handler.
   */
  public removeHandler(method: string): void {
    this.handlers.delete(method);
  }

  /**
   * Call an RPC method on the remote peer with binary Uint8Array payload.
   */
  public async call<K extends keyof TRemoteSchema & string>(
    method: K,
    data?: Uint8Array
  ): Promise<InferRpcReturn<TRemoteSchema, K>> {
    if (this.isDestroyed) {
      throw new ConnectionClosedError('RPC engine is destroyed');
    }

    const requestId = this.generateId();
    const payload = data || new Uint8Array(0);

    return new Promise<InferRpcReturn<TRemoteSchema, K>>((resolve, reject) => {
      const resolver = (val: Uint8Array) => resolve(val as InferRpcReturn<TRemoteSchema, K>);

      if (this.channel && this.channel.readyState === 'open') {
        this.sendRequest(requestId, method, payload, resolver, reject);
      } else {
        this.queuedRequests.push({
          id: requestId,
          method,
          payload,
          resolve: resolver,
          reject,
        });
      }
    });
  }

  private sendRequest(
    requestId: string,
    method: string,
    payload: Uint8Array,
    resolve: (value: Uint8Array) => void,
    reject: (reason: Error | unknown) => void
  ): void {
    const timeoutMs = this.defaultTimeout;

    const timer = setTimeout(() => {
      this.pendingRequests.delete(requestId);
      reject(new RpcTimeoutError(method, timeoutMs));
    }, timeoutMs);

    this.pendingRequests.set(requestId, {
      resolve,
      reject,
      timer,
      method,
    });

    const requestMsg: ProtoRpcMessage = {
      request: {
        id: requestId,
        method,
        payload,
      },
    };

    try {
      const encodedBuffer = encodeRpcMessage(requestMsg);
      this.channel!.send(encodedBuffer as unknown as ArrayBuffer);
    } catch (err) {
      clearTimeout(timer);
      this.pendingRequests.delete(requestId);
      const errorMessage = err instanceof Error ? err.message : String(err);
      reject(new LightRPCError(`Failed to send RPC request: ${errorMessage}`));
    }
  }

  /**
   * Reject all queued requests with a given error.
   */
  public rejectQueue(reason: Error): void {
    const queue = [...this.queuedRequests];
    this.queuedRequests = [];
    for (const req of queue) {
      req.reject(reason);
    }
    this.outboundResponsesQueue = [];
  }

  /**
   * Handle incoming binary WebRTC data messages.
   */
  public handleMessage(rawMessage: unknown): void {
    try {
      const bytes = normalizeRawMessage(rawMessage);
      if (bytes.length === 0) return;

      const message = decodeRpcMessage(bytes);

      if (message.request && message.request.id) {
        this.handleIncomingRequest(message.request);
      } else if (message.response && message.response.id) {
        this.handleIncomingResponse(message.response);
      }
    } catch {
      return;
    }
  }

  private async handleIncomingRequest(req: ProtoRpcRequest): Promise<void> {
    const handler = this.handlers.get(req.method);

    if (!handler) {
      const errorMsg: ProtoRpcMessage = {
        response: {
          id: req.id,
          error: {
            code: 'METHOD_NOT_FOUND',
            message: `RPC method '${req.method}' is not registered on receiver peer`,
          },
        },
      };
      this.sendRaw(errorMsg);
      return;
    }

    try {
      const payload = req.payload || new Uint8Array(0);
      const rawResult = await handler(payload);
      const binaryResult = rawResult instanceof Uint8Array ? rawResult : new Uint8Array(0);

      const successMsg: ProtoRpcMessage = {
        response: {
          id: req.id,
          result: binaryResult,
        },
      };
      this.sendRaw(successMsg);
    } catch (err) {
      const errCode = (err as { code?: string })?.code || 'REMOTE_EXECUTION_ERROR';
      const errData = (err as { data?: unknown })?.data;
      const errorMessage = err instanceof Error ? err.message : String(err);

      const errorMsg: ProtoRpcMessage = {
        response: {
          id: req.id,
          error: {
            code: errCode,
            message: errorMessage,
            data: errData instanceof Uint8Array ? errData : undefined,
          },
        },
      };
      this.sendRaw(errorMsg);
    }
  }

  private handleIncomingResponse(resp: ProtoRpcResponse): void {
    const pending = this.pendingRequests.get(resp.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(resp.id);

    if (resp.error && resp.error.code) {
      if (resp.error.code === 'METHOD_NOT_FOUND') {
        pending.reject(new MethodNotFoundError(pending.method));
      } else {
        pending.reject(
          new RpcExecutionError(pending.method, resp.error.message, resp.error.code, resp.error.data)
        );
      }
    } else {
      const resultData = resp.result || new Uint8Array(0);
      pending.resolve(resultData);
    }
  }

  private sendRaw(msg: ProtoRpcMessage): void {
    if (this.channel && this.channel.readyState === 'open') {
      try {
        const encodedBuffer = encodeRpcMessage(msg);
        this.channel.send(encodedBuffer as unknown as ArrayBuffer);
      } catch {
        this.outboundResponsesQueue.push(msg);
      }
    } else {
      this.outboundResponsesQueue.push(msg);
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  }

  /**
   * Cancel all pending/queued requests and clean up.
   */
  public destroy(reason = 'RPC engine destroyed'): void {
    this.isDestroyed = true;
    const err = new ConnectionClosedError(reason);

    this.rejectQueue(err);

    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
    this.setChannel(null);
  }
}
