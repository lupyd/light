export declare const EMPTY_BYTES: Uint8Array<ArrayBuffer>;
export declare const RPC_ERROR_CODES: {
    readonly INTERNAL_ERROR: 1;
    readonly TIMEOUT: 2;
    readonly METHOD_NOT_FOUND: 3;
    readonly REMOTE_EXECUTION_ERROR: 4;
    readonly CONNECTION_CLOSED: 5;
    readonly MAX_RETRIES_EXCEEDED: 6;
};
export interface ProtoRpcError {
    code: number;
    message: string;
    data?: Uint8Array;
}
export interface ProtoRpcRequest {
    id: number;
    method: string;
    payload?: Uint8Array;
}
export interface ProtoRpcResponse {
    id: number;
    result?: Uint8Array;
    error?: ProtoRpcError;
}
export interface ProtoRpcMessage {
    request?: ProtoRpcRequest;
    response?: ProtoRpcResponse;
}
export interface ProtoDatagramMessage {
    topic: string;
    payload: Uint8Array;
    timestamp: number;
}
export declare function encodeRpcMessage(msg: ProtoRpcMessage): Uint8Array;
export declare function decodeRpcMessage(buffer: Uint8Array): ProtoRpcMessage;
export declare function encodeDatagramMessage(msg: ProtoDatagramMessage): Uint8Array;
export declare function decodeDatagramMessage(buffer: Uint8Array): ProtoDatagramMessage;
export declare function normalizeRawMessage(rawMessage: unknown): Uint8Array;
//# sourceMappingURL=protocol.d.ts.map