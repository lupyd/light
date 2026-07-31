export type DatagramCallback = (payload: Uint8Array, timestamp: number) => void;
export declare class DatagramEngine {
    private channel;
    private topicListeners;
    private globalListeners;
    /**
     * Bind active RTCDataChannel used for datagram transmission.
     */
    setChannel(channel: RTCDataChannel | null): void;
    /**
     * Send an unreliable datagram with a topic and binary Uint8Array payload.
     */
    sendDatagram(topic: string, payload: Uint8Array): boolean;
    /**
     * Send a raw buffer datagram directly over the channel.
     */
    sendRawDatagram(data: ArrayBuffer | Uint8Array): boolean;
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
        payload: Uint8Array;
        timestamp: number;
    }) => void): () => void;
    handleMessage(rawMessage: unknown): void;
    destroy(): void;
}
//# sourceMappingURL=datagram.d.ts.map