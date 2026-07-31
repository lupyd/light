import type { DatagramMessage } from './types.js';

export type DatagramCallback = (payload: any, timestamp: number) => void;

export class DatagramEngine {
  private channel: RTCDataChannel | null = null;
  private topicListeners: Map<string, Set<DatagramCallback>> = new Map();
  private globalListeners: Set<(event: { topic: string; payload: any; timestamp: number }) => void> = new Set();

  /**
   * Bind active RTCDataChannel used for datagram transmission.
   */
  public setChannel(channel: RTCDataChannel | null): void {
    if (this.channel) {
      this.channel.onmessage = null;
    }

    this.channel = channel;

    if (this.channel) {
      this.channel.onmessage = (event) => this.handleMessage(event.data);
    }
  }

  /**
   * Send an unreliable datagram with a topic and payload.
   */
  public sendDatagram(topic: string, payload: any): boolean {
    if (!this.channel || this.channel.readyState !== 'open') {
      return false;
    }

    const message: DatagramMessage = {
      type: 'datagram',
      topic,
      payload,
      timestamp: Date.now(),
    };

    try {
      this.channel.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send a raw buffer or string datagram directly over the channel.
   */
  public sendRawDatagram(data: string | ArrayBuffer | Uint8Array): boolean {
    if (!this.channel || this.channel.readyState !== 'open') {
      return false;
    }

    try {
      this.channel.send(data as any);
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
  public onAnyDatagram(listener: (event: { topic: string; payload: any; timestamp: number }) => void): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  public handleMessage(rawMessage: any): void {
    let message: DatagramMessage;
    try {
      let str: string;
      if (typeof rawMessage === 'string') {
        str = rawMessage;
      } else if (rawMessage instanceof Uint8Array || ArrayBuffer.isView(rawMessage)) {
        str = new TextDecoder().decode(rawMessage);
      } else if (rawMessage instanceof ArrayBuffer) {
        str = new TextDecoder().decode(rawMessage);
      } else {
        str = String(rawMessage);
      }
      message = JSON.parse(str);
    } catch {
      // Not a JSON datagram message (could be raw data)
      return;
    }

    if (message && message.type === 'datagram') {
      const { topic, payload, timestamp } = message;

      // Call topic listeners
      const listeners = this.topicListeners.get(topic);
      if (listeners) {
        for (const callback of listeners) {
          try {
            callback(payload, timestamp);
          } catch (e) {
            console.error(`Error in datagram listener for topic '${topic}':`, e);
          }
        }
      }

      // Call global listeners
      for (const globalListener of this.globalListeners) {
        try {
          globalListener({ topic, payload, timestamp });
        } catch (e) {
          console.error(`Error in global datagram listener:`, e);
        }
      }
    }
  }

  public destroy(): void {
    this.topicListeners.clear();
    this.globalListeners.clear();
    this.setChannel(null);
  }
}
