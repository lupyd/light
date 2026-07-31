export class LightRPCError extends Error {
  public readonly code: string;
  public readonly data?: unknown;

  constructor(message: string, code = 'INTERNAL_ERROR', data?: unknown) {
    super(message);
    this.name = 'LightRPCError';
    this.code = code;
    this.data = data;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RpcTimeoutError extends LightRPCError {
  constructor(method: string, timeoutMs: number) {
    super(`RPC call to '${method}' timed out after ${timeoutMs}ms`, 'TIMEOUT');
    this.name = 'RpcTimeoutError';
  }
}

export class MethodNotFoundError extends LightRPCError {
  constructor(method: string) {
    super(`RPC method '${method}' not found on remote peer`, 'METHOD_NOT_FOUND');
    this.name = 'MethodNotFoundError';
  }
}

export class RpcExecutionError extends LightRPCError {
  constructor(method: string, remoteMessage: string, remoteCode = 'REMOTE_EXECUTION_ERROR', data?: unknown) {
    super(`RPC method '${method}' failed on remote peer: ${remoteMessage}`, remoteCode, data);
    this.name = 'RpcExecutionError';
  }
}

export class ConnectionClosedError extends LightRPCError {
  constructor(reason = 'Peer connection or data channel closed') {
    super(`RPC request cancelled: ${reason}`, 'CONNECTION_CLOSED');
    this.name = 'ConnectionClosedError';
  }
}

export class MaxRetriesExceededError extends LightRPCError {
  constructor(attempts = 3) {
    super(`Max reconnection attempts (${attempts}) exceeded`, 'MAX_RETRIES_EXCEEDED');
    this.name = 'MaxRetriesExceededError';
  }
}
