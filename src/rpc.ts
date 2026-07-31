import {
  ConnectionClosedError,
  LightRPCError,
  MethodNotFoundError,
  RpcExecutionError,
  RpcTimeoutError,
} from './errors.js';
import type {
  InferRpcParams,
  InferRpcReturn,
  RpcMessage,
  RpcRequestMessage,
  RpcResponseMessage,
  RpcResponseMessageError,
  RpcResponseMessageSuccess,
  RpcSchema,
} from './types.js';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: any;
  method: string;
}

interface QueuedRequest {
  id: string;
  method: string;
  params: any[];
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

export class RpcEngine<
  TLocalSchema extends RpcSchema = RpcSchema,
  TRemoteSchema extends RpcSchema = RpcSchema
> {
  private handlers: Map<string, Function> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private queuedRequests: QueuedRequest[] = [];
  private outboundResponsesQueue: RpcResponseMessage[] = [];
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
    if (this.channel && this.channel.readyState === 'open') {
      this.flushQueue();
    }
  }

  /**
   * Called when the RTCDataChannel opens.
   */
  public onChannelOpen(): void {
    this.flushQueue();
  }

  /**
   * Called when the RTCDataChannel closes.
   */
  public onChannelClose(): void {
    this.channel = null;
  }

  /**
   * Flush and send all queued RPC requests and responses over the open data channel.
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
      this.sendRequest(req.id, req.method, req.params, req.resolve, req.reject);
    }
  }

  /**
   * Register local RPC handlers.
   */
  public registerHandlers(handlers: Partial<TLocalSchema> | TLocalSchema): void {
    for (const [method, handler] of Object.entries(handlers)) {
      if (typeof handler === 'function') {
        this.handlers.set(method, handler);
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
      this.handlers.set(method as string, handler);
    }
  }

  /**
   * Remove a registered handler.
   */
  public removeHandler(method: string): void {
    this.handlers.delete(method);
  }

  /**
   * Call an RPC method on the remote peer with strict type safety.
   * If disconnected or connecting, queues the call until reconnected.
   */
  public async call<K extends keyof TRemoteSchema & string>(
    method: K,
    ...args: InferRpcParams<TRemoteSchema, K>
  ): Promise<InferRpcReturn<TRemoteSchema, K>> {
    if (this.isDestroyed) {
      throw new ConnectionClosedError('RPC engine is destroyed');
    }

    const requestId = this.generateId();

    return new Promise<InferRpcReturn<TRemoteSchema, K>>((resolve, reject) => {
      if (this.channel && this.channel.readyState === 'open') {
        this.sendRequest(requestId, method, args, resolve, reject);
      } else {
        this.queuedRequests.push({
          id: requestId,
          method,
          params: args,
          resolve,
          reject,
        });
      }
    });
  }

  private sendRequest(
    requestId: string,
    method: string,
    args: any[],
    resolve: (value: any) => void,
    reject: (reason: any) => void
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

    const requestMessage: RpcRequestMessage = {
      type: 'rpc_request',
      id: requestId,
      method,
      params: args,
    };

    try {
      this.channel!.send(JSON.stringify(requestMessage));
    } catch (err: any) {
      clearTimeout(timer);
      this.pendingRequests.delete(requestId);
      reject(new LightRPCError(`Failed to send RPC request: ${err?.message || err}`));
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
   * Handle incoming serialized WebRTC data messages.
   */
  public handleMessage(rawMessage: any): void {
    let message: RpcMessage;
    try {
      let str: string;
      if (typeof rawMessage === 'string') {
        str = rawMessage;
      } else if (rawMessage instanceof Uint8Array || ArrayBuffer.isView(rawMessage)) {
        str = new TextDecoder().decode(rawMessage);
      } else if (rawMessage instanceof ArrayBuffer) {
        str = new TextDecoder().decode(rawMessage);
      } else {
        str = String(rawMessage);
      }
      message = JSON.parse(str);
    } catch {
      // Ignore malformed messages
      return;
    }

    if (message.type === 'rpc_request') {
      this.handleIncomingRequest(message);
    } else if (message.type === 'rpc_response') {
      this.handleIncomingResponse(message);
    }
  }

  private async handleIncomingRequest(msg: RpcRequestMessage): Promise<void> {
    const handler = this.handlers.get(msg.method);

    if (!handler) {
      const errorResponse: RpcResponseMessageError = {
        type: 'rpc_response',
        id: msg.id,
        error: {
          code: 'METHOD_NOT_FOUND',
          message: `RPC method '${msg.method}' is not registered on receiver peer`,
        },
      };
      this.sendRaw(errorResponse);
      return;
    }

    try {
      const result = await handler(...(msg.params || []));
      const successResponse: RpcResponseMessageSuccess = {
        type: 'rpc_response',
        id: msg.id,
        result: result === undefined ? null : result,
      };
      this.sendRaw(successResponse);
    } catch (err: any) {
      const errorResponse: RpcResponseMessageError = {
        type: 'rpc_response',
        id: msg.id,
        error: {
          code: err?.code || 'REMOTE_EXECUTION_ERROR',
          message: err?.message || String(err),
          data: err?.data,
        },
      };
      this.sendRaw(errorResponse);
    }
  }

  private handleIncomingResponse(msg: RpcResponseMessage): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(msg.id);

    if (msg.error) {
      if (msg.error.code === 'METHOD_NOT_FOUND') {
        pending.reject(new MethodNotFoundError(pending.method));
      } else {
        pending.reject(
          new RpcExecutionError(pending.method, msg.error.message, msg.error.code, msg.error.data)
        );
      }
    } else {
      pending.resolve(msg.result);
    }
  }

  private sendRaw(data: RpcResponseMessage): void {
    if (this.channel && this.channel.readyState === 'open') {
      try {
        this.channel.send(JSON.stringify(data));
      } catch (e) {
        this.outboundResponsesQueue.push(data);
      }
    } else {
      this.outboundResponsesQueue.push(data);
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

    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
    this.setChannel(null);
  }
}
