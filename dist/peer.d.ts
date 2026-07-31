import { EventEmitter } from 'node:events';
import type { ConnectionState, InferRpcParams, InferRpcReturn, LightPeerEvents, LightPeerOptions, RpcSchema, SignalData } from './types';
export declare class LightPeer<TLocalSchema extends RpcSchema = RpcSchema, TRemoteSchema extends RpcSchema = RpcSchema> extends EventEmitter {
    private pc;
    private rpcEngine;
    private datagramEngine;
    private isInitiator;
    private rpcChannelLabel;
    private datagramChannelLabel;
    private rpcChannel;
    private datagramChannel;
    private _connectionState;
    private adapter;
    private rtcConfig;
    private autoReconnect;
    private maxRetries;
    private reconnectDelay;
    private reconnectTimeout;
    private retryCount;
    private isReconnecting;
    private isClosed;
    private reconnectTimer;
    private attemptTimer;
    private pendingIceCandidates;
    constructor(options?: LightPeerOptions<TLocalSchema, TRemoteSchema>);
    /**
     * Current WebRTC connection state.
     */
    get connectionState(): ConnectionState;
    /**
     * Whether the RPC data channel is open and ready to transmit calls.
     */
    get isReady(): boolean;
    /**
     * Current reconnection retry attempt count.
     */
    get currentRetryCount(): number;
    /**
     * Returns a Promise that resolves when the peer connection and data channel are ready.
     */
    waitUntilReady(timeoutMs?: number): Promise<void>;
    /**
     * Initiate connection (if initiator). Generates local SDP offer and emits 'signal'.
     */
    connect(): Promise<void>;
    /**
     * Process incoming WebRTC signal (SDP offer, SDP answer, or ICE candidate).
     */
    handleSignal(signal: SignalData): Promise<void>;
    /**
     * Perform an RPC call to the remote peer.
     * Queues call seamlessly if disconnected or connecting, sending once reconnected.
     */
    call<K extends keyof TRemoteSchema & string>(method: K, ...args: InferRpcParams<TRemoteSchema, K>): Promise<InferRpcReturn<TRemoteSchema, K>>;
    /**
     * Dynamically register or update a local RPC handler.
     */
    registerHandler<K extends keyof TLocalSchema & string>(method: K, handler: TLocalSchema[K]): void;
    /**
     * Register multiple local RPC handlers.
     */
    registerHandlers(handlers: Partial<TLocalSchema> | TLocalSchema): void;
    /**
     * Remove a registered handler.
     */
    removeHandler(method: string): void;
    /**
     * Send an unreliable datagram to the remote peer.
     */
    sendDatagram(topic: string, payload: any): boolean;
    /**
     * Send raw datagram buffer or string.
     */
    sendRawDatagram(data: string | ArrayBuffer | Uint8Array): boolean;
    /**
     * Subscribe to incoming datagrams for a specific topic.
     */
    onDatagram(topic: string, callback: (payload: any, timestamp: number) => void): () => void;
    /**
     * Unsubscribe from datagrams for a specific topic.
     */
    offDatagram(topic: string, callback: (payload: any, timestamp: number) => void): void;
    /**
     * Close connection, reject queued/pending calls, and free resources.
     */
    close(): void;
    on<E extends keyof LightPeerEvents<TLocalSchema, TRemoteSchema>>(event: E, listener: LightPeerEvents<TLocalSchema, TRemoteSchema>[E]): this;
    off<E extends keyof LightPeerEvents<TLocalSchema, TRemoteSchema>>(event: E, listener: LightPeerEvents<TLocalSchema, TRemoteSchema>[E]): this;
    emit<E extends keyof LightPeerEvents<TLocalSchema, TRemoteSchema>>(event: E, ...args: Parameters<LightPeerEvents<TLocalSchema, TRemoteSchema>[E]>): boolean;
    private createPeerConnection;
    private setupPeerConnectionEvents;
    private handleDisconnect;
    private setupInitiatorChannels;
    private setupReceiverChannels;
    private attachRpcChannel;
    private attachDatagramChannel;
    private flushPendingIceCandidates;
    private checkIfReady;
    private updateConnectionState;
    private emitSignal;
}
//# sourceMappingURL=peer.d.ts.map