import protobuf from 'protobufjs';

export const EMPTY_BYTES = new Uint8Array(0);

export const RPC_ERROR_CODES = {
  INTERNAL_ERROR: 1,
  TIMEOUT: 2,
  METHOD_NOT_FOUND: 3,
  REMOTE_EXECUTION_ERROR: 4,
  CONNECTION_CLOSED: 5,
  MAX_RETRIES_EXCEEDED: 6,
} as const;

// Build Protobuf Root Schema
const root = new protobuf.Root();
const ns = root.define('light.protocol');

ns.add(
  new protobuf.Type('RpcError')
    .add(new protobuf.Field('code', 1, 'uint32'))
    .add(new protobuf.Field('message', 2, 'string'))
    .add(new protobuf.Field('data', 3, 'bytes', 'optional'))
);

ns.add(
  new protobuf.Type('RpcRequest')
    .add(new protobuf.Field('id', 1, 'uint32'))
    .add(new protobuf.Field('method', 2, 'string'))
    .add(new protobuf.Field('payload', 3, 'bytes', 'optional'))
);

ns.add(
  new protobuf.Type('RpcResponse')
    .add(new protobuf.Field('id', 1, 'uint32'))
    .add(new protobuf.Field('result', 2, 'bytes', 'optional'))
    .add(new protobuf.Field('error', 3, 'RpcError', 'optional'))
);

ns.add(
  new protobuf.Type('RpcMessage')
    .add(new protobuf.Field('request', 1, 'RpcRequest', 'optional'))
    .add(new protobuf.Field('response', 2, 'RpcResponse', 'optional'))
);

ns.add(
  new protobuf.Type('DatagramMessage')
    .add(new protobuf.Field('topic', 1, 'string'))
    .add(new protobuf.Field('payload', 2, 'bytes'))
    .add(new protobuf.Field('timestamp', 3, 'int64'))
);

const RpcMessageType = root.lookupType('light.protocol.RpcMessage');
const DatagramMessageType = root.lookupType('light.protocol.DatagramMessage');

export interface ProtoRpcError {
  code: number; // u32 error code
  message: string;
  data?: Uint8Array;
}

export interface ProtoRpcRequest {
  id: number; // u32 request ID
  method: string;
  payload?: Uint8Array;
}

export interface ProtoRpcResponse {
  id: number; // u32 request ID
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

// Protobuf Encoding/Decoding Utilities

export function encodeRpcMessage(msg: ProtoRpcMessage): Uint8Array {
  const message = RpcMessageType.create(msg);
  return RpcMessageType.encode(message).finish();
}

export function decodeRpcMessage(buffer: Uint8Array): ProtoRpcMessage {
  const decoded = RpcMessageType.decode(buffer);
  return RpcMessageType.toObject(decoded, {
    bytes: Uint8Array,
    defaults: true,
  }) as ProtoRpcMessage;
}

export function encodeDatagramMessage(msg: ProtoDatagramMessage): Uint8Array {
  const message = DatagramMessageType.create(msg);
  return DatagramMessageType.encode(message).finish();
}

export function decodeDatagramMessage(buffer: Uint8Array): ProtoDatagramMessage {
  const decoded = DatagramMessageType.decode(buffer);
  return DatagramMessageType.toObject(decoded, {
    bytes: Uint8Array,
    defaults: true,
  }) as ProtoDatagramMessage;
}

// Pure Binary Normalization

export function normalizeRawMessage(rawMessage: unknown): Uint8Array {
  if (rawMessage instanceof Uint8Array) {
    return rawMessage;
  }
  if (rawMessage instanceof ArrayBuffer) {
    return new Uint8Array(rawMessage);
  }
  if (ArrayBuffer.isView(rawMessage)) {
    return new Uint8Array(rawMessage.buffer, rawMessage.byteOffset, rawMessage.byteLength);
  }
  return EMPTY_BYTES;
}
