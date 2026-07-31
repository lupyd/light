export type DatagramCallback = (payload: any, timestamp: number) => void;
export declare class DatagramEngine {
    private channel;
    private topicListeners;
    private globalListeners;
    /**
     * Bind active RTCDataChannel used for datagram transmission.
     */
    setChannel(channel: RTCDataChannel | null): void;
    /**
     * Send an unreliable datagram with a topic and payload.
     */
    sendDatagram(topic: string, payload: any): boolean;
    /**
     * Send a raw buffer or string datagram directly over the channel.
     */
    sendRawDatagram(data: string | ArrayBuffer | Uint8Array): boolean;
    /**
     * Subscribe to datagrams on a specific topic.
     */
    onDatagram(topic: string, callback: DatagramCallback): () => void;
    /**
     * Unsubscribe from datagrams on a specific topic.
     */
    offDatagram(topic: string, callback: DatagramCallback): void;
    /**
     * Subscribe to all incoming datagram events.
     */
    onAnyDatagram(listener: (event: {
        topic: string;
        payload: any;
        timestamp: number;
    }) => void): () => void;
    handleMessage(rawMessage: any): void;
    destroy(): void;
}
//# sourceMappingURL=datagram.d.ts.map