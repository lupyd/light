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
            this.channel.onmessage = (event) => this.handleMessage(event.data);
        }
    }
    /**
     * Send an unreliable datagram with a topic and payload.
     */
    sendDatagram(topic, payload) {
        if (!this.channel || this.channel.readyState !== 'open') {
            return false;
        }
        const message = {
            type: 'datagram',
            topic,
            payload,
            timestamp: Date.now(),
        };
        try {
            this.channel.send(JSON.stringify(message));
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Send a raw buffer or string datagram directly over the channel.
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
                    }
                    catch (e) {
                        console.error(`Error in datagram listener for topic '${topic}':`, e);
                    }
                }
            }
            // Call global listeners
            for (const globalListener of this.globalListeners) {
                try {
                    globalListener({ topic, payload, timestamp });
                }
                catch (e) {
                    console.error(`Error in global datagram listener:`, e);
                }
            }
        }
    }
    destroy() {
        this.topicListeners.clear();
        this.globalListeners.clear();
        this.setChannel(null);
    }
}
//# sourceMappingURL=datagram.js.map