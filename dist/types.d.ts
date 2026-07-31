export type RpcFunction = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;
export type RpcSchema = Record<string, RpcFunction>;
export type InferRpcReturn<TSchema extends RpcSchema, K extends keyof TSchema> = TSchema[K] extends (data: Uint8Array) => infer R ? Awaited<R> : Uint8Array;
export type SignalData = {
    type: 'offer';
    sdp: string;
} | {
    type: 'answer';
    sdp: string;
} | {
    type: 'candidate';
    candidate: RTCIceCandidateInit;
};
export type ConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
export interface WebRTCAdapter {
    RTCPeerConnection: typeof RTCPeerConnection;
    RTCSessionDescription: typeof RTCSessionDescription;
    RTCIceCandidate: typeof RTCIceCandidate;
}
export interface LightPeerOptions<TLocalSchema extends RpcSchema = RpcSchema, TRemoteSchema extends RpcSchema = RpcSchema> {
    /**
     * Whether this peer should initiate the WebRTC connection offer.
     */
    initiator?: boolean;
    /**
     * RTCConfiguration passed to RTCPeerConnection (e.g. iceServers).
     */
    rtcConfig?: RTCConfiguration;
    /**
     * Custom WebRTC implementation adapter (overrides automatic environment detection).
     */
    webrtc?: WebRTCAdapter;
    /**
     * Local RPC handlers implementing functions for TLocalSchema.
     */
    handlers?: Partial<TLocalSchema> | TLocalSchema;
    /**
     * Default timeout in milliseconds for RPC calls. Defaults to 10,000ms.
     */
    rpcTimeout?: number;
    /**
     * Data channel configuration options.
     */
    channels?: {
        /**
         * Label for the reliable RPC data channel. Default: 'light-rpc'
         */
        rpcLabel?: string;
        /**
         * Label for the unreliable datagram data channel. Default: 'light-datagram'
         */
        datagramLabel?: string;
    };
    /**
     * Whether to automatically attempt reconnection on disconnection. Default: true.
     */
    autoReconnect?: boolean;
    /**
     * Maximum number of reconnection attempts before giving up. Default: 3.
     */
    maxRetries?: number;
    /**
     * Delay in milliseconds between reconnection attempts. Default: 1000ms.
     */
    reconnectDelay?: number;
    /**
     * Timeout in milliseconds for each reconnection attempt before moving to the next retry. Default: 5000ms.
     */
    reconnectTimeout?: number;
}
export interface LightPeerEvents<TLocalSchema extends RpcSchema = RpcSchema, TRemoteSchema extends RpcSchema = RpcSchema> {
    signal: (signal: SignalData) => void;
    connectionStateChange: (state: ConnectionState) => void;
    reconnecting: (attempt: number) => void;
    reconnectFailed: () => void;
    ready: () => void;
    close: () => void;
    error: (err: Error) => void;
    datagram: (event: {
        topic: string;
        payload: Uint8Array;
        timestamp: number;
    }) => void;
}
//# sourceMappingURL=types.d.ts.map