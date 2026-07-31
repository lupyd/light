export declare class LightRPCError extends Error {
    readonly code: string;
    readonly data?: any;
    constructor(message: string, code?: string, data?: any);
}
export declare class RpcTimeoutError extends LightRPCError {
    constructor(method: string, timeoutMs: number);
}
export declare class MethodNotFoundError extends LightRPCError {
    constructor(method: string);
}
export declare class RpcExecutionError extends LightRPCError {
    constructor(method: string, remoteMessage: string, remoteCode?: string, data?: any);
}
export declare class ConnectionClosedError extends LightRPCError {
    constructor(reason?: string);
}
export declare class MaxRetriesExceededError extends LightRPCError {
    constructor(attempts?: number);
}
//# sourceMappingURL=errors.d.ts.map