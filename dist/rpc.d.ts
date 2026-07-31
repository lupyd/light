import type { InferRpcReturn, RpcSchema } from './types';
export declare class RpcEngine<TLocalSchema extends RpcSchema = RpcSchema, TRemoteSchema extends RpcSchema = RpcSchema> {
    private handlers;
    private pendingRequests;
    private queuedRequests;
    private outboundResponsesQueue;
    private channel;
    private defaultTimeout;
    private isDestroyed;
    constructor(handlers?: Partial<TLocalSchema> | TLocalSchema, defaultTimeout?: number);
    /**
     * Set or update the active RTCDataChannel used for RPC communication.
     */
    setChannel(channel: RTCDataChannel | null): void;
    /**
     * Called when the RTCDataChannel opens.
     */
    onChannelOpen(): void;
    /**
     * Called when the RTCDataChannel closes.
     */
    onChannelClose(): void;
    /**
     * Flush and send all queued Protobuf RPC requests and responses over the open binary data channel.
     */
    flushQueue(): void;
    /**
     * Register local RPC handlers.
     */
    registerHandlers(handlers: Partial<TLocalSchema> | TLocalSchema): void;
    /**
     * Register a single local RPC handler.
     */
    registerHandler<K extends keyof TLocalSchema>(method: K, handler: TLocalSchema[K]): void;
    /**
     * Remove a registered handler.
     */
    removeHandler(method: string): void;
    /**
     * Call an RPC method on the remote peer with binary Uint8Array payload.
     */
    call<K extends keyof TRemoteSchema & string>(method: K, data?: Uint8Array): Promise<InferRpcReturn<TRemoteSchema, K>>;
    private sendRequest;
    /**
     * Reject all queued requests with a given error.
     */
    rejectQueue(reason: Error): void;
    /**
     * Handle incoming binary WebRTC data messages.
     */
    handleMessage(rawMessage: unknown): void;
    private handleIncomingRequest;
    private handleIncomingResponse;
    private sendRaw;
    private generateId;
    /**
     * Cancel all pending/queued requests and clean up.
     */
    destroy(reason?: string): void;
}
//# sourceMappingURL=rpc.d.ts.map