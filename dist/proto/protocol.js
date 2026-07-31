import protobuf from 'protobufjs';
// Build Protobuf Root Schema
const root = new protobuf.Root();
const ns = root.define('light.protocol');
ns.add(new protobuf.Type('RpcError')
    .add(new protobuf.Field('code', 1, 'string'))
    .add(new protobuf.Field('message', 2, 'string'))
    .add(new protobuf.Field('data', 3, 'bytes', 'optional')));
ns.add(new protobuf.Type('RpcRequest')
    .add(new protobuf.Field('id', 1, 'string'))
    .add(new protobuf.Field('method', 2, 'string'))
    .add(new protobuf.Field('payload', 3, 'bytes', 'optional')));
ns.add(new protobuf.Type('RpcResponse')
    .add(new protobuf.Field('id', 1, 'string'))
    .add(new protobuf.Field('result', 2, 'bytes', 'optional'))
    .add(new protobuf.Field('error', 3, 'RpcError', 'optional')));
ns.add(new protobuf.Type('RpcMessage')
    .add(new protobuf.Field('request', 1, 'RpcRequest', 'optional'))
    .add(new protobuf.Field('response', 2, 'RpcResponse', 'optional')));
ns.add(new protobuf.Type('DatagramMessage')
    .add(new protobuf.Field('topic', 1, 'string'))
    .add(new protobuf.Field('payload', 2, 'bytes'))
    .add(new protobuf.Field('timestamp', 3, 'int64')));
const RpcMessageType = root.lookupType('light.protocol.RpcMessage');
const DatagramMessageType = root.lookupType('light.protocol.DatagramMessage');
// Protobuf Encoding/Decoding Utilities
export function encodeRpcMessage(msg) {
    const message = RpcMessageType.create(msg);
    return RpcMessageType.encode(message).finish();
}
export function decodeRpcMessage(buffer) {
    const decoded = RpcMessageType.decode(buffer);
    return RpcMessageType.toObject(decoded, {
        bytes: Uint8Array,
        defaults: true,
    });
}
export function encodeDatagramMessage(msg) {
    const message = DatagramMessageType.create(msg);
    return DatagramMessageType.encode(message).finish();
}
export function decodeDatagramMessage(buffer) {
    const decoded = DatagramMessageType.decode(buffer);
    return DatagramMessageType.toObject(decoded, {
        bytes: Uint8Array,
        defaults: true,
    });
}
// Pure Binary Normalization
export function normalizeRawMessage(rawMessage) {
    if (rawMessage instanceof Uint8Array) {
        return rawMessage;
    }
    if (rawMessage instanceof ArrayBuffer) {
        return new Uint8Array(rawMessage);
    }
    if (ArrayBuffer.isView(rawMessage)) {
        return new Uint8Array(rawMessage.buffer, rawMessage.byteOffset, rawMessage.byteLength);
    }
    return new Uint8Array(0);
}
//# sourceMappingURL=protocol.js.map