import {
  decodeDatagramMessage,
  encodeDatagramMessage,
  EMPTY_BYTES,
  normalizeRawMessage,
} from './proto/protocol';

export type DatagramCallback = (payload: Uint8Array, timestamp: number) => void;

export class DatagramEngine {
  private channel: RTCDataChannel | null = null;
  private topicListeners: Map<string, Set<DatagramCallback>> = new Map();
  private globalListeners: Set<(event: { topic: string; payload: Uint8Array; timestamp: number }) => void> = new Set();

  /**
   * Bind active RTCDataChannel used for datagram transmission.
   */
  public setChannel(channel: RTCDataChannel | null): void {
    if (this.channel) {
      this.channel.onmessage = null;
    }

    this.channel = channel;

    if (this.channel) {
      try {
        this.channel.binaryType = 'arraybuffer';
      } catch {}
      this.channel.onmessage = (event) => this.handleMessage(event.data);
    }
  }

  /**
   * Send an unreliable datagram with a topic and binary Uint8Array payload.
   */
  public sendDatagram(topic: string, payload: Uint8Array): boolean {
    if (!this.channel || this.channel.readyState !== 'open') {
      return false;
    }

    const binaryPayload = payload || EMPTY_BYTES;

    try {
      const binaryMsg = encodeDatagramMessage({
        topic,
        payload: binaryPayload,
        timestamp: Date.now(),
      });

      this.channel.send(binaryMsg as unknown as ArrayBuffer);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send a raw buffer datagram directly over the channel.
   */
  public sendRawDatagram(data: ArrayBuffer | Uint8Array): boolean {
    if (!this.channel || this.channel.readyState !== 'open') {
      return false;
    }

    try {
      this.channel.send(data as unknown as ArrayBuffer);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Subscribe to datagrams on a specific topic.
   */
  public onDatagram(topic: string, callback: DatagramCallback): () => void {
    let listeners = this.topicListeners.get(topic);
    if (!listeners) {
      listeners = new Set();
      this.topicListeners.set(topic, listeners);
    }
    listeners.add(callback);

    return () => {
      this.offDatagram(topic, callback);
    };
  }

  /**
   * Unsubscribe from datagrams on a specific topic.
   */
  public offDatagram(topic: string, callback: DatagramCallback): void {
    const listeners = this.topicListeners.get(topic);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.topicListeners.delete(topic);
      }
    }
  }

  /**
   * Subscribe to all incoming datagram events.
   */
  public onAnyDatagram(listener: (event: { topic: string; payload: Uint8Array; timestamp: number }) => void): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  public handleMessage(rawMessage: unknown): void {
    try {
      const bytes = normalizeRawMessage(rawMessage);
      if (bytes.length === 0) return;

      const message = decodeDatagramMessage(bytes);

      if (message && message.topic) {
        const { topic, payload, timestamp } = message;
        const binaryPayload = payload || EMPTY_BYTES;

        // Call topic listeners
        const listeners = this.topicListeners.get(topic);
        if (listeners) {
          for (const callback of listeners) {
            try {
              callback(binaryPayload, timestamp);
            } catch (e) {
              console.error(`Error in datagram listener for topic '${topic}':`, e);
            }
          }
        }

        // Call global listeners
        for (const globalListener of this.globalListeners) {
          try {
            globalListener({ topic, payload: binaryPayload, timestamp });
          } catch (e) {
            console.error(`Error in global datagram listener:`, e);
          }
        }
      }
    } catch {
      return;
    }
  }

  public destroy(): void {
    this.topicListeners.clear();
    this.globalListeners.clear();
    this.setChannel(null);
  }
}
