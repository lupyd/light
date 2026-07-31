import { ConnectionClosedError, LightRPCError, MethodNotFoundError, RpcExecutionError, RpcTimeoutError, } from './errors';
import { decodeRpcMessage, encodeRpcMessage, normalizeRawMessage, } from './proto/protocol';
export class RpcEngine {
    handlers = new Map();
    pendingRequests = new Map();
    queuedRequests = [];
    outboundResponsesQueue = [];
    channel = null;
    defaultTimeout;
    isDestroyed = false;
    constructor(handlers, defaultTimeout = 10000) {
        this.defaultTimeout = defaultTimeout;
        if (handlers) {
            this.registerHandlers(handlers);
        }
    }
    /**
     * Set or update the active RTCDataChannel used for RPC communication.
     */
    setChannel(channel) {
        this.channel = channel;
        if (this.channel) {
            try {
                this.channel.binaryType = 'arraybuffer';
            }
            catch { }
            if (this.channel.readyState === 'open') {
                this.flushQueue();
            }
        }
    }
    /**
     * Called when the RTCDataChannel opens.
     */
    onChannelOpen() {
        if (this.channel) {
            try {
                this.channel.binaryType = 'arraybuffer';
            }
            catch { }
        }
        this.flushQueue();
    }
    /**
     * Called when the RTCDataChannel closes.
     */
    onChannelClose() {
        this.channel = null;
    }
    /**
     * Flush and send all queued Protobuf RPC requests and responses over the open binary data channel.
     */
    flushQueue() {
        if (!this.channel || this.channel.readyState !== 'open' || this.isDestroyed) {
            return;
        }
        const responses = [...this.outboundResponsesQueue];
        this.outboundResponsesQueue = [];
        for (const resp of responses) {
            this.sendRaw(resp);
        }
        const queue = [...this.queuedRequests];
        this.queuedRequests = [];
        for (const req of queue) {
            this.sendRequest(req.id, req.method, req.payload, req.resolve, req.reject);
        }
    }
    /**
     * Register local RPC handlers.
     */
    registerHandlers(handlers) {
        for (const [method, handler] of Object.entries(handlers)) {
            if (typeof handler === 'function') {
                this.handlers.set(method, handler);
            }
        }
    }
    /**
     * Register a single local RPC handler.
     */
    registerHandler(method, handler) {
        if (typeof handler === 'function') {
            this.handlers.set(method, handler);
        }
    }
    /**
     * Remove a registered handler.
     */
    removeHandler(method) {
        this.handlers.delete(method);
    }
    /**
     * Call an RPC method on the remote peer with binary Uint8Array payload.
     */
    async call(method, data) {
        if (this.isDestroyed) {
            throw new ConnectionClosedError('RPC engine is destroyed');
        }
        const requestId = this.generateId();
        const payload = data || new Uint8Array(0);
        return new Promise((resolve, reject) => {
            const resolver = (val) => resolve(val);
            if (this.channel && this.channel.readyState === 'open') {
                this.sendRequest(requestId, method, payload, resolver, reject);
            }
            else {
                this.queuedRequests.push({
                    id: requestId,
                    method,
                    payload,
                    resolve: resolver,
                    reject,
                });
            }
        });
    }
    sendRequest(requestId, method, payload, resolve, reject) {
        const timeoutMs = this.defaultTimeout;
        const timer = setTimeout(() => {
            this.pendingRequests.delete(requestId);
            reject(new RpcTimeoutError(method, timeoutMs));
        }, timeoutMs);
        this.pendingRequests.set(requestId, {
            resolve,
            reject,
            timer,
            method,
        });
        const requestMsg = {
            request: {
                id: requestId,
                method,
                payload,
            },
        };
        try {
            const encodedBuffer = encodeRpcMessage(requestMsg);
            this.channel.send(encodedBuffer);
        }
        catch (err) {
            clearTimeout(timer);
            this.pendingRequests.delete(requestId);
            const errorMessage = err instanceof Error ? err.message : String(err);
            reject(new LightRPCError(`Failed to send RPC request: ${errorMessage}`));
        }
    }
    /**
     * Reject all queued requests with a given error.
     */
    rejectQueue(reason) {
        const queue = [...this.queuedRequests];
        this.queuedRequests = [];
        for (const req of queue) {
            req.reject(reason);
        }
        this.outboundResponsesQueue = [];
    }
    /**
     * Handle incoming binary WebRTC data messages.
     */
    handleMessage(rawMessage) {
        try {
            const bytes = normalizeRawMessage(rawMessage);
            if (bytes.length === 0)
                return;
            const message = decodeRpcMessage(bytes);
            if (message.request && message.request.id) {
                this.handleIncomingRequest(message.request);
            }
            else if (message.response && message.response.id) {
                this.handleIncomingResponse(message.response);
            }
        }
        catch {
            return;
        }
    }
    async handleIncomingRequest(req) {
        const handler = this.handlers.get(req.method);
        if (!handler) {
            const errorMsg = {
                response: {
                    id: req.id,
                    error: {
                        code: 'METHOD_NOT_FOUND',
                        message: `RPC method '${req.method}' is not registered on receiver peer`,
                    },
                },
            };
            this.sendRaw(errorMsg);
            return;
        }
        try {
            const payload = req.payload || new Uint8Array(0);
            const rawResult = await handler(payload);
            const binaryResult = rawResult instanceof Uint8Array ? rawResult : new Uint8Array(0);
            const successMsg = {
                response: {
                    id: req.id,
                    result: binaryResult,
                },
            };
            this.sendRaw(successMsg);
        }
        catch (err) {
            const errCode = err?.code || 'REMOTE_EXECUTION_ERROR';
            const errData = err?.data;
            const errorMessage = err instanceof Error ? err.message : String(err);
            const errorMsg = {
                response: {
                    id: req.id,
                    error: {
                        code: errCode,
                        message: errorMessage,
                        data: errData instanceof Uint8Array ? errData : undefined,
                    },
                },
            };
            this.sendRaw(errorMsg);
        }
    }
    handleIncomingResponse(resp) {
        const pending = this.pendingRequests.get(resp.id);
        if (!pending)
            return;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(resp.id);
        if (resp.error && resp.error.code) {
            if (resp.error.code === 'METHOD_NOT_FOUND') {
                pending.reject(new MethodNotFoundError(pending.method));
            }
            else {
                pending.reject(new RpcExecutionError(pending.method, resp.error.message, resp.error.code, resp.error.data));
            }
        }
        else {
            const resultData = resp.result || new Uint8Array(0);
            pending.resolve(resultData);
        }
    }
    sendRaw(msg) {
        if (this.channel && this.channel.readyState === 'open') {
            try {
                const encodedBuffer = encodeRpcMessage(msg);
                this.channel.send(encodedBuffer);
            }
            catch {
                this.outboundResponsesQueue.push(msg);
            }
        }
        else {
            this.outboundResponsesQueue.push(msg);
        }
    }
    generateId() {
        return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    }
    /**
     * Cancel all pending/queued requests and clean up.
     */
    destroy(reason = 'RPC engine destroyed') {
        this.isDestroyed = true;
        const err = new ConnectionClosedError(reason);
        this.rejectQueue(err);
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this.pendingRequests.clear();
        this.setChannel(null);
    }
}
//# sourceMappingURL=rpc.js.map