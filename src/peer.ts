import { EventEmitter } from 'node:events';
import { DatagramEngine } from './datagram.js';
import { ConnectionClosedError, LightRPCError, MaxRetriesExceededError } from './errors.js';
import { RpcEngine } from './rpc.js';
import type {
  ConnectionState,
  InferRpcParams,
  InferRpcReturn,
  LightPeerEvents,
  LightPeerOptions,
  RpcSchema,
  SignalData,
} from './types.js';
import { getWebRTCAdapter } from './webrtc-adapter.js';

export class LightPeer<
  TLocalSchema extends RpcSchema = RpcSchema,
  TRemoteSchema extends RpcSchema = RpcSchema
> extends EventEmitter {
  private pc!: RTCPeerConnection;
  private rpcEngine: RpcEngine<TLocalSchema, TRemoteSchema>;
  private datagramEngine: DatagramEngine;

  private isInitiator: boolean;
  private rpcChannelLabel: string;
  private datagramChannelLabel: string;

  private rpcChannel: RTCDataChannel | null = null;
  private datagramChannel: RTCDataChannel | null = null;

  private _connectionState: ConnectionState = 'new';
  private adapter: ReturnType<typeof getWebRTCAdapter>;
  private rtcConfig: RTCConfiguration;

  private autoReconnect: boolean;
  private maxRetries: number;
  private reconnectDelay: number;
  private reconnectTimeout: number;
  private retryCount = 0;
  private isReconnecting = false;
  private isClosed = false;
  private reconnectTimer: any = null;
  private attemptTimer: any = null;

  private pendingIceCandidates: RTCIceCandidateInit[] = [];

  constructor(options: LightPeerOptions<TLocalSchema, TRemoteSchema> = {}) {
    super();

    this.isInitiator = options.initiator ?? false;
    this.rpcChannelLabel = options.channels?.rpcLabel ?? 'light-rpc';
    this.datagramChannelLabel = options.channels?.datagramLabel ?? 'light-datagram';

    this.autoReconnect = options.autoReconnect ?? true;
    this.maxRetries = options.maxRetries ?? 3;
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.reconnectTimeout = options.reconnectTimeout ?? 5000;

    this.adapter = getWebRTCAdapter(options.webrtc);
    this.rpcEngine = new RpcEngine<TLocalSchema, TRemoteSchema>(
      options.handlers,
      options.rpcTimeout ?? 10000
    );
    this.datagramEngine = new DatagramEngine();

    this.rtcConfig = options.rtcConfig || {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    };

    this.createPeerConnection();
  }

  /**
   * Current WebRTC connection state.
   */
  public get connectionState(): ConnectionState {
    return this._connectionState;
  }

  /**
   * Whether the RPC data channel is open and ready to transmit calls.
   */
  public get isReady(): boolean {
    return this.rpcChannel !== null && this.rpcChannel.readyState === 'open';
  }

  /**
   * Current reconnection retry attempt count.
   */
  public get currentRetryCount(): number {
    return this.retryCount;
  }

  /**
   * Returns a Promise that resolves when the peer connection and data channel are ready.
   */
  public async waitUntilReady(timeoutMs = 15000): Promise<void> {
    if (this.isReady) return;

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
  public async connect(): Promise<void> {
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
    } catch (err: any) {
      this.emit('error', new LightRPCError(`Failed to create offer: ${err?.message || err}`));
    }
  }

  /**
   * Process incoming WebRTC signal (SDP offer, SDP answer, or ICE candidate).
   */
  public async handleSignal(signal: SignalData): Promise<void> {
    if (this.isClosed) return;

    try {
      if (signal.type === 'offer') {
        if (
          !this.isInitiator &&
          (this.isReconnecting ||
            this.pc.connectionState === 'failed' ||
            this.pc.connectionState === 'closed')
        ) {
          this.createPeerConnection();
        }

        await this.pc.setRemoteDescription({
          type: 'offer',
          sdp: signal.sdp,
        } as RTCSessionDescriptionInit);

        await this.flushPendingIceCandidates();

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);

        this.emitSignal({
          type: 'answer',
          sdp: answer.sdp || '',
        });
      } else if (signal.type === 'answer') {
        await this.pc.setRemoteDescription({
          type: 'answer',
          sdp: signal.sdp,
        } as RTCSessionDescriptionInit);

        await this.flushPendingIceCandidates();
      } else if (signal.type === 'candidate') {
        if (signal.candidate) {
          if (this.pc.remoteDescription) {
            await this.pc.addIceCandidate(signal.candidate);
          } else {
            this.pendingIceCandidates.push(signal.candidate);
          }
        }
      }
    } catch (err: any) {
      this.emit('error', new LightRPCError(`Error handling signal [${signal.type}]: ${err?.message || err}`));
    }
  }

  /**
   * Perform an RPC call to the remote peer.
   * Queues call seamlessly if disconnected or connecting, sending once reconnected.
   */
  public call<K extends keyof TRemoteSchema & string>(
    method: K,
    ...args: InferRpcParams<TRemoteSchema, K>
  ): Promise<InferRpcReturn<TRemoteSchema, K>> {
    return this.rpcEngine.call(method, ...args);
  }

  /**
   * Dynamically register or update a local RPC handler.
   */
  public registerHandler<K extends keyof TLocalSchema & string>(
    method: K,
    handler: TLocalSchema[K]
  ): void {
    this.rpcEngine.registerHandler(method, handler);
  }

  /**
   * Register multiple local RPC handlers.
   */
  public registerHandlers(handlers: Partial<TLocalSchema> | TLocalSchema): void {
    this.rpcEngine.registerHandlers(handlers);
  }

  /**
   * Remove a registered handler.
   */
  public removeHandler(method: string): void {
    this.rpcEngine.removeHandler(method);
  }

  /**
   * Send an unreliable datagram to the remote peer.
   */
  public sendDatagram(topic: string, payload: any): boolean {
    return this.datagramEngine.sendDatagram(topic, payload);
  }

  /**
   * Send raw datagram buffer or string.
   */
  public sendRawDatagram(data: string | ArrayBuffer | Uint8Array): boolean {
    return this.datagramEngine.sendRawDatagram(data);
  }

  /**
   * Subscribe to incoming datagrams for a specific topic.
   */
  public onDatagram(topic: string, callback: (payload: any, timestamp: number) => void): () => void {
    return this.datagramEngine.onDatagram(topic, callback);
  }

  /**
   * Unsubscribe from datagrams for a specific topic.
   */
  public offDatagram(topic: string, callback: (payload: any, timestamp: number) => void): void {
    this.datagramEngine.offDatagram(topic, callback);
  }

  /**
   * Close connection, reject queued/pending calls, and free resources.
   */
  public close(): void {
    if (this.isClosed) return;

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
      } catch {}
      this.rpcChannel = null;
    }

    if (this.datagramChannel) {
      try {
        this.datagramChannel.close();
      } catch {}
      this.datagramChannel = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
    }

    this.emit('close');
  }

  public override on<E extends keyof LightPeerEvents<TLocalSchema, TRemoteSchema>>(
    event: E,
    listener: LightPeerEvents<TLocalSchema, TRemoteSchema>[E]
  ): this {
    return super.on(event, listener as any);
  }

  public override off<E extends keyof LightPeerEvents<TLocalSchema, TRemoteSchema>>(
    event: E,
    listener: LightPeerEvents<TLocalSchema, TRemoteSchema>[E]
  ): this {
    return super.off(event, listener as any);
  }

  public override emit<E extends keyof LightPeerEvents<TLocalSchema, TRemoteSchema>>(
    event: E,
    ...args: Parameters<LightPeerEvents<TLocalSchema, TRemoteSchema>[E]>
  ): boolean {
    return super.emit(event, ...args);
  }

  private createPeerConnection(): void {
    if (this.pc) {
      try {
        this.pc.onicecandidate = null;
        this.pc.onconnectionstatechange = null;
        this.pc.oniceconnectionstatechange = null;
        this.pc.ondatachannel = null;
        this.pc.close();
      } catch {}
    }

    this.pc = new this.adapter.RTCPeerConnection(this.rtcConfig);
    this.setupPeerConnectionEvents();

    if (this.isInitiator) {
      this.setupInitiatorChannels();
    } else {
      this.setupReceiverChannels();
    }
  }

  private setupPeerConnectionEvents(): void {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.emitSignal({
          type: 'candidate',
          candidate:
            typeof (event.candidate as any).toJSON === 'function'
              ? (event.candidate as any).toJSON()
              : {
                  candidate: event.candidate.candidate,
                  sdpMid: event.candidate.sdpMid,
                  sdpMLineIndex: event.candidate.sdpMLineIndex,
                  usernameFragment: (event.candidate as any).usernameFragment,
                },
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState as ConnectionState;
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

  private handleDisconnect(): void {
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
      if (this.isClosed) return;
      try {
        this.createPeerConnection();
        if (this.isInitiator) {
          await this.connect();
        }

        if (this.attemptTimer) clearTimeout(this.attemptTimer);
        this.attemptTimer = setTimeout(() => {
          if (this._connectionState !== 'connected' && !this.isClosed) {
            this.isReconnecting = false;
            this.handleDisconnect();
          }
        }, this.reconnectTimeout);

      } catch (err: any) {
        this.emit('error', new LightRPCError(`Reconnection attempt ${this.retryCount} failed: ${err?.message || err}`));
        this.isReconnecting = false;
        this.handleDisconnect();
      }
    }, this.reconnectDelay);
  }

  private setupInitiatorChannels(): void {
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

  private setupReceiverChannels(): void {
    this.pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === this.rpcChannelLabel) {
        this.attachRpcChannel(channel);
      } else if (channel.label === this.datagramChannelLabel) {
        this.attachDatagramChannel(channel);
      }
    };
  }

  private attachRpcChannel(channel: RTCDataChannel): void {
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

    if (channel.readyState === 'open' || (channel as any).state === 'open') {
      onOpen();
    } else {
      channel.onopen = onOpen;
      if (typeof (channel as any).on === 'function') {
        (channel as any).on('open', onOpen);
      }
    }

    channel.onclose = () => {
      this.rpcEngine.onChannelClose();
      if (!this.isClosed) {
        this.handleDisconnect();
      }
    };
  }

  private attachDatagramChannel(channel: RTCDataChannel): void {
    this.datagramChannel = channel;

    channel.onmessage = (event) => {
      this.datagramEngine.handleMessage(event.data);
    };

    this.datagramEngine.setChannel(channel);

    if (channel.readyState !== 'open') {
      channel.onopen = () => {};
    }

    channel.onclose = () => {
      this.datagramEngine.setChannel(null);
    };

    this.datagramEngine.onAnyDatagram((datagram) => {
      this.emit('datagram', datagram);
    });
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.pc.remoteDescription) return;
    const candidates = [...this.pendingIceCandidates];
    this.pendingIceCandidates = [];
    for (const candidate of candidates) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        // Ignored
      }
    }
  }

  private checkIfReady(): void {
    if (this.isReady) {
      this.emit('ready');
    }
  }

  private updateConnectionState(state: ConnectionState): void {
    if (this._connectionState !== state) {
      this._connectionState = state;
      this.emit('connectionStateChange', state);
    }
  }

  private emitSignal(signal: SignalData): void {
    this.emit('signal', signal);
  }
}
