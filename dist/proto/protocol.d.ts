export interface ProtoRpcError {
    code: string;
    message: string;
    data?: Uint8Array;
}
export interface ProtoRpcRequest {
    id: string;
    method: string;
    payload?: Uint8Array;
}
export interface ProtoRpcResponse {
    id: string;
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