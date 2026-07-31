import { ConnectionClosedError, LightRPCError, MethodNotFoundError, RpcExecutionError, RpcTimeoutError, } from './errors.js';
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
        if (this.channel && this.channel.readyState === 'open') {
            this.flushQueue();
        }
    }
    /**
     * Called when the RTCDataChannel opens.
     */
    onChannelOpen() {
        this.flushQueue();
    }
    /**
     * Called when the RTCDataChannel closes.
     */
    onChannelClose() {
        this.channel = null;
    }
    /**
     * Flush and send all queued RPC requests and responses over the open data channel.
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
            this.sendRequest(req.id, req.method, req.params, req.resolve, req.reject);
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
     * Call an RPC method on the remote peer with strict type safety.
     * If disconnected or connecting, queues the call until reconnected.
     */
    async call(method, ...args) {
        if (this.isDestroyed) {
            throw new ConnectionClosedError('RPC engine is destroyed');
        }
        const requestId = this.generateId();
        return new Promise((resolve, reject) => {
            if (this.channel && this.channel.readyState === 'open') {
                this.sendRequest(requestId, method, args, resolve, reject);
            }
            else {
                this.queuedRequests.push({
                    id: requestId,
                    method,
                    params: args,
                    resolve,
                    reject,
                });
            }
        });
    }
    sendRequest(requestId, method, args, resolve, reject) {
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
        const requestMessage = {
            type: 'rpc_request',
            id: requestId,
            method,
            params: args,
        };
        try {
            this.channel.send(JSON.stringify(requestMessage));
        }
        catch (err) {
            clearTimeout(timer);
            this.pendingRequests.delete(requestId);
            reject(new LightRPCError(`Failed to send RPC request: ${err?.message || err}`));
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
     * Handle incoming serialized WebRTC data messages.
     */
    handleMessage(rawMessage) {
        let message;
        try {
            let str;
            if (typeof rawMessage === 'string') {
                str = rawMessage;
            }
            else if (rawMessage instanceof Uint8Array || ArrayBuffer.isView(rawMessage)) {
                str = new TextDecoder().decode(rawMessage);
            }
            else if (rawMessage instanceof ArrayBuffer) {
                str = new TextDecoder().decode(rawMessage);
            }
            else {
                str = String(rawMessage);
            }
            message = JSON.parse(str);
        }
        catch {
            // Ignore malformed messages
            return;
        }
        if (message.type === 'rpc_request') {
            this.handleIncomingRequest(message);
        }
        else if (message.type === 'rpc_response') {
            this.handleIncomingResponse(message);
        }
    }
    async handleIncomingRequest(msg) {
        const handler = this.handlers.get(msg.method);
        if (!handler) {
            const errorResponse = {
                type: 'rpc_response',
                id: msg.id,
                error: {
                    code: 'METHOD_NOT_FOUND',
                    message: `RPC method '${msg.method}' is not registered on receiver peer`,
                },
            };
            this.sendRaw(errorResponse);
            return;
        }
        try {
            const result = await handler(...(msg.params || []));
            const successResponse = {
                type: 'rpc_response',
                id: msg.id,
                result: result === undefined ? null : result,
            };
            this.sendRaw(successResponse);
        }
        catch (err) {
            const errorResponse = {
                type: 'rpc_response',
                id: msg.id,
                error: {
                    code: err?.code || 'REMOTE_EXECUTION_ERROR',
                    message: err?.message || String(err),
                    data: err?.data,
                },
            };
            this.sendRaw(errorResponse);
        }
    }
    handleIncomingResponse(msg) {
        const pending = this.pendingRequests.get(msg.id);
        if (!pending)
            return;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
            if (msg.error.code === 'METHOD_NOT_FOUND') {
                pending.reject(new MethodNotFoundError(pending.method));
            }
            else {
                pending.reject(new RpcExecutionError(pending.method, msg.error.message, msg.error.code, msg.error.data));
            }
        }
        else {
            pending.resolve(msg.result);
        }
    }
    sendRaw(data) {
        if (this.channel && this.channel.readyState === 'open') {
            try {
                this.channel.send(JSON.stringify(data));
            }
            catch (e) {
                this.outboundResponsesQueue.push(data);
            }
        }
        else {
            this.outboundResponsesQueue.push(data);
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
        for (const [id, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this.pendingRequests.clear();
        this.setChannel(null);
    }
}
//# sourceMappingURL=rpc.js.map