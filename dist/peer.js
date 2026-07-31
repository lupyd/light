import { EventEmitter } from 'node:events';
import { DatagramEngine } from './datagram';
import { ConnectionClosedError, LightRPCError, MaxRetriesExceededError } from './errors';
import { RpcEngine } from './rpc';
import { getWebRTCAdapter } from './webrtc-adapter';
export class LightPeer extends EventEmitter {
    pc;
    rpcEngine;
    datagramEngine;
    isInitiator;
    rpcChannelLabel;
    datagramChannelLabel;
    rpcChannel = null;
    datagramChannel = null;
    _connectionState = 'new';
    adapter;
    rtcConfig;
    autoReconnect;
    maxRetries;
    reconnectDelay;
    reconnectTimeout;
    retryCount = 0;
    isReconnecting = false;
    isClosed = false;
    reconnectTimer = null;
    attemptTimer = null;
    pendingIceCandidates = [];
    constructor(options = {}) {
        super();
        this.isInitiator = options.initiator ?? false;
        this.rpcChannelLabel = options.channels?.rpcLabel ?? 'light-rpc';
        this.datagramChannelLabel = options.channels?.datagramLabel ?? 'light-datagram';
        this.autoReconnect = options.autoReconnect ?? true;
        this.maxRetries = options.maxRetries ?? 3;
        this.reconnectDelay = options.reconnectDelay ?? 1000;
        this.reconnectTimeout = options.reconnectTimeout ?? 5000;
        this.adapter = getWebRTCAdapter(options.webrtc);
        this.rpcEngine = new RpcEngine(options.handlers, options.rpcTimeout ?? 10000);
        this.datagramEngine = new DatagramEngine();
        this.rtcConfig = options.rtcConfig || {
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        };
        this.createPeerConnection();
    }
    /**
     * Current WebRTC connection state.
     */
    get connectionState() {
        return this._connectionState;
    }
    /**
     * Whether the RPC data channel is open and ready to transmit calls.
     */
    get isReady() {
        return this.rpcChannel !== null && this.rpcChannel.readyState === 'open';
    }
    /**
     * Current reconnection retry attempt count.
     */
    get currentRetryCount() {
        return this.retryCount;
    }
    /**
     * Returns a Promise that resolves when the peer connection and data channel are ready.
     */
    async waitUntilReady(timeoutMs = 15000) {
        if (this.isReady)
            return;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new LightRPCError(`waitUntilReady timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            const onReady = () => {
                cleanup();
                resolve();
            };
            const onClose = () => {
                cleanup();
                reject(new ConnectionClosedError('Peer closed before becoming ready'));
            };
            const cleanup = () => {
                clearTimeout(timer);
                this.off('ready', onReady);
                this.off('close', onClose);
            };
            this.on('ready', onReady);
            this.on('close', onClose);
        });
    }
    /**
     * Initiate connection (if initiator). Generates local SDP offer and emits 'signal'.
     */
    async connect() {
        if (!this.isInitiator || this.isClosed) {
            return;
        }
        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            this.emitSignal({
                type: 'offer',
                sdp: offer.sdp || '',
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.emit('error', new LightRPCError(`Failed to create offer: ${message}`));
        }
    }
    /**
     * Process incoming WebRTC signal (SDP offer, SDP answer, or ICE candidate).
     */
    async handleSignal(signal) {
        if (this.isClosed)
            return;
        try {
            if (signal.type === 'offer') {
                if (!this.isInitiator &&
                    (this.isReconnecting ||
                        this.pc.connectionState === 'failed' ||
                        this.pc.connectionState === 'closed')) {
                    this.createPeerConnection();
                }
                await this.pc.setRemoteDescription({
                    type: 'offer',
                    sdp: signal.sdp,
                });
                await this.flushPendingIceCandidates();
                const answer = await this.pc.createAnswer();
                await this.pc.setLocalDescription(answer);
                this.emitSignal({
                    type: 'answer',
                    sdp: answer.sdp || '',
                });
            }
            else if (signal.type === 'answer') {
                await this.pc.setRemoteDescription({
                    type: 'answer',
                    sdp: signal.sdp,
                });
                await this.flushPendingIceCandidates();
            }
            else if (signal.type === 'candidate') {
                if (signal.candidate) {
                    if (this.pc.remoteDescription) {
                        await this.pc.addIceCandidate(signal.candidate);
                    }
                    else {
                        this.pendingIceCandidates.push(signal.candidate);
                    }
                }
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.emit('error', new LightRPCError(`Error handling signal [${signal.type}]: ${message}`));
        }
    }
    /**
     * Perform an RPC call to the remote peer with binary Uint8Array data.
     * Queues call seamlessly if disconnected or connecting, sending once reconnected.
     */
    call(method, data) {
        return this.rpcEngine.call(method, data);
    }
    /**
     * Dynamically register or update a local RPC handler.
     */
    registerHandler(method, handler) {
        this.rpcEngine.registerHandler(method, handler);
    }
    /**
     * Register multiple local RPC handlers.
     */
    registerHandlers(handlers) {
        this.rpcEngine.registerHandlers(handlers);
    }
    /**
     * Remove a registered handler.
     */
    removeHandler(method) {
        this.rpcEngine.removeHandler(method);
    }
    /**
     * Send an unreliable datagram with binary Uint8Array payload.
     */
    sendDatagram(topic, payload) {
        return this.datagramEngine.sendDatagram(topic, payload);
    }
    /**
     * Send raw datagram buffer.
     */
    sendRawDatagram(data) {
        return this.datagramEngine.sendRawDatagram(data);
    }
    /**
     * Subscribe to incoming datagrams for a specific topic.
     */
    onDatagram(topic, callback) {
        return this.datagramEngine.onDatagram(topic, callback);
    }
    /**
     * Unsubscribe from datagrams for a specific topic.
     */
    offDatagram(topic, callback) {
        this.datagramEngine.offDatagram(topic, callback);
    }
    /**
     * Close connection, reject queued/pending calls, and free resources.
     */
    close() {
        if (this.isClosed)
            return;
        this.isClosed = true;
        this.autoReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.attemptTimer) {
            clearTimeout(this.attemptTimer);
            this.attemptTimer = null;
        }
        this.updateConnectionState('closed');
        this.rpcEngine.destroy('Peer closed');
        this.datagramEngine.destroy();
        if (this.rpcChannel) {
            try {
                this.rpcChannel.close();
            }
            catch { }
            this.rpcChannel = null;
        }
        if (this.datagramChannel) {
            try {
                this.datagramChannel.close();
            }
            catch { }
            this.datagramChannel = null;
        }
        if (this.pc) {
            try {
                this.pc.close();
            }
            catch { }
        }
        this.emit('close');
    }
    on(event, listener) {
        return super.on(event, listener);
    }
    off(event, listener) {
        return super.off(event, listener);
    }
    emit(event, ...args) {
        return super.emit(event, ...args);
    }
    createPeerConnection() {
        if (this.pc) {
            try {
                this.pc.onicecandidate = null;
                this.pc.onconnectionstatechange = null;
                this.pc.oniceconnectionstatechange = null;
                this.pc.ondatachannel = null;
                this.pc.close();
            }
            catch { }
        }
        this.pc = new this.adapter.RTCPeerConnection(this.rtcConfig);
        this.setupPeerConnectionEvents();
        if (this.isInitiator) {
            this.setupInitiatorChannels();
        }
        else {
            this.setupReceiverChannels();
        }
    }
    setupPeerConnectionEvents() {
        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.emitSignal({
                    type: 'candidate',
                    candidate: {
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex,
                        usernameFragment: event.candidate.usernameFragment,
                    },
                });
            }
        };
        this.pc.onconnectionstatechange = () => {
            const state = this.pc.connectionState;
            this.updateConnectionState(state);
            if (state === 'disconnected' || state === 'failed') {
                this.handleDisconnect();
            }
        };
        this.pc.oniceconnectionstatechange = () => {
            if (this.pc.iceConnectionState === 'failed') {
                this.updateConnectionState('failed');
                this.handleDisconnect();
            }
        };
    }
    handleDisconnect() {
        if (this.isClosed || this.isReconnecting) {
            return;
        }
        if (!this.autoReconnect) {
            this.updateConnectionState('failed');
            return;
        }
        if (this.retryCount >= this.maxRetries) {
            this.updateConnectionState('failed');
            const err = new MaxRetriesExceededError(this.maxRetries);
            this.emit('error', err);
            this.emit('reconnectFailed');
            this.rpcEngine.rejectQueue(err);
            this.close();
            return;
        }
        this.isReconnecting = true;
        this.retryCount++;
        this.updateConnectionState('connecting');
        this.emit('reconnecting', this.retryCount);
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = setTimeout(async () => {
            if (this.isClosed)
                return;
            try {
                this.createPeerConnection();
                if (this.isInitiator) {
                    await this.connect();
                }
                if (this.attemptTimer)
                    clearTimeout(this.attemptTimer);
                this.attemptTimer = setTimeout(() => {
                    if (this._connectionState !== 'connected' && !this.isClosed) {
                        this.isReconnecting = false;
                        this.handleDisconnect();
                    }
                }, this.reconnectTimeout);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.emit('error', new LightRPCError(`Reconnection attempt ${this.retryCount} failed: ${message}`));
                this.isReconnecting = false;
                this.handleDisconnect();
            }
        }, this.reconnectDelay);
    }
    setupInitiatorChannels() {
        const rpcChan = this.pc.createDataChannel(this.rpcChannelLabel, {
            ordered: true,
        });
        this.attachRpcChannel(rpcChan);
        const datagramChan = this.pc.createDataChannel(this.datagramChannelLabel, {
            ordered: false,
            maxRetransmits: 0,
        });
        this.attachDatagramChannel(datagramChan);
    }
    setupReceiverChannels() {
        this.pc.ondatachannel = (event) => {
            const channel = event.channel;
            if (channel.label === this.rpcChannelLabel) {
                this.attachRpcChannel(channel);
            }
            else if (channel.label === this.datagramChannelLabel) {
                this.attachDatagramChannel(channel);
            }
        };
    }
    attachRpcChannel(channel) {
        this.rpcChannel = channel;
        channel.onmessage = (event) => {
            this.rpcEngine.handleMessage(event.data);
        };
        this.rpcEngine.setChannel(channel);
        const onOpen = () => {
            this.retryCount = 0;
            this.isReconnecting = false;
            if (this.attemptTimer) {
                clearTimeout(this.attemptTimer);
                this.attemptTimer = null;
            }
            this.updateConnectionState('connected');
            this.checkIfReady();
            this.rpcEngine.onChannelOpen();
        };
        const chanState = channel.state;
        if (channel.readyState === 'open' || chanState === 'open') {
            onOpen();
        }
        else {
            channel.onopen = onOpen;
            const chanWithOn = channel;
            if (typeof chanWithOn.on === 'function') {
                chanWithOn.on('open', onOpen);
            }
        }
        channel.onclose = () => {
            this.rpcEngine.onChannelClose();
            if (!this.isClosed) {
                this.handleDisconnect();
            }
        };
    }
    attachDatagramChannel(channel) {
        this.datagramChannel = channel;
        channel.onmessage = (event) => {
            this.datagramEngine.handleMessage(event.data);
        };
        this.datagramEngine.setChannel(channel);
        if (channel.readyState !== 'open') {
            channel.onopen = () => { };
        }
        channel.onclose = () => {
            this.datagramEngine.setChannel(null);
        };
        this.datagramEngine.onAnyDatagram((datagram) => {
            this.emit('datagram', datagram);
        });
    }
    async flushPendingIceCandidates() {
        if (!this.pc.remoteDescription)
            return;
        const candidates = [...this.pendingIceCandidates];
        this.pendingIceCandidates = [];
        for (const candidate of candidates) {
            try {
                await this.pc.addIceCandidate(candidate);
            }
            catch {
                // Ignored
            }
        }
    }
    checkIfReady() {
        if (this.isReady) {
            this.emit('ready');
        }
    }
    updateConnectionState(state) {
        if (this._connectionState !== state) {
            this._connectionState = state;
            this.emit('connectionStateChange', state);
        }
    }
    emitSignal(signal) {
        this.emit('signal', signal);
    }
}
//# sourceMappingURL=peer.js.map