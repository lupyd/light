import type { WebRTCAdapter } from './types.js';
/**
 * Explicitly set a global WebRTC adapter (useful for custom polyfills).
 */
export declare function setWebRTCAdapter(adapter: WebRTCAdapter): void;
/**
 * Get WebRTC implementation adapter.
 * Fallbacks in order:
 * 1. User-provided adapter (arg or setWebRTCAdapter)
 * 2. Browser native global RTCPeerConnection
 * 3. Node/Bun werift WebRTC package
 */
export declare function getWebRTCAdapter(overrideAdapter?: WebRTCAdapter): WebRTCAdapter;
//# sourceMappingURL=webrtc-adapter.d.ts.map