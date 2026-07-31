import { RPC_ERROR_CODES } from './proto/protocol';

export class LightRPCError extends Error {
  public readonly code: number;
  public readonly data?: unknown;

  constructor(message: string, code: number = RPC_ERROR_CODES.INTERNAL_ERROR, data?: unknown) {
    super(message);
    this.name = 'LightRPCError';
    this.code = code;
    this.data = data;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RpcTimeoutError extends LightRPCError {
  constructor(method: string, timeoutMs: number) {
    super(`RPC call to '${method}' timed out after ${timeoutMs}ms`, RPC_ERROR_CODES.TIMEOUT);
    this.name = 'RpcTimeoutError';
  }
}

export class MethodNotFoundError extends LightRPCError {
  constructor(method: string) {
    super(`RPC method '${method}' not found on remote peer`, RPC_ERROR_CODES.METHOD_NOT_FOUND);
    this.name = 'MethodNotFoundError';
  }
}

export class RpcExecutionError extends LightRPCError {
  constructor(method: string, remoteMessage: string, remoteCode: number = RPC_ERROR_CODES.REMOTE_EXECUTION_ERROR, data?: unknown) {
    super(`RPC method '${method}' failed on remote peer: ${remoteMessage}`, remoteCode, data);
    this.name = 'RpcExecutionError';
  }
}

export class ConnectionClosedError extends LightRPCError {
  constructor(reason = 'Peer connection or data channel closed') {
    super(`RPC request cancelled: ${reason}`, RPC_ERROR_CODES.CONNECTION_CLOSED);
    this.name = 'ConnectionClosedError';
  }
}

export class MaxRetriesExceededError extends LightRPCError {
  constructor(attempts = 3) {
    super(`Max reconnection attempts (${attempts}) exceeded`, RPC_ERROR_CODES.MAX_RETRIES_EXCEEDED);
    this.name = 'MaxRetriesExceededError';
  }
}
