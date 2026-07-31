import { decodeDatagramMessage, encodeDatagramMessage, EMPTY_BYTES, normalizeRawMessage, } from './proto/protocol';
export class DatagramEngine {
    channel = null;
    topicListeners = new Map();
    globalListeners = new Set();
    /**
     * Bind active RTCDataChannel used for datagram transmission.
     */
    setChannel(channel) {
        if (this.channel) {
            this.channel.onmessage = null;
        }
        this.channel = channel;
        if (this.channel) {
            try {
                this.channel.binaryType = 'arraybuffer';
            }
            catch { }
            this.channel.onmessage = (event) => this.handleMessage(event.data);
        }
    }
    /**
     * Send an unreliable datagram with a topic and binary Uint8Array payload.
     */
    sendDatagram(topic, payload) {
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
            this.channel.send(binaryMsg);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Send a raw buffer datagram directly over the channel.
     */
    sendRawDatagram(data) {
        if (!this.channel || this.channel.readyState !== 'open') {
            return false;
        }
        try {
            this.channel.send(data);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Subscribe to datagrams on a specific topic.
     */
    onDatagram(topic, callback) {
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
    offDatagram(topic, callback) {
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
    onAnyDatagram(listener) {
        this.globalListeners.add(listener);
        return () => {
            this.globalListeners.delete(listener);
        };
    }
    handleMessage(rawMessage) {
        try {
            const bytes = normalizeRawMessage(rawMessage);
            if (bytes.length === 0)
                return;
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
                        }
                        catch (e) {
                            console.error(`Error in datagram listener for topic '${topic}':`, e);
                        }
                    }
                }
                // Call global listeners
                for (const globalListener of this.globalListeners) {
                    try {
                        globalListener({ topic, payload: binaryPayload, timestamp });
                    }
                    catch (e) {
                        console.error(`Error in global datagram listener:`, e);
                    }
                }
            }
        }
        catch {
            return;
        }
    }
    destroy() {
        this.topicListeners.clear();
        this.globalListeners.clear();
        this.setChannel(null);
    }
}
//# sourceMappingURL=datagram.js.map