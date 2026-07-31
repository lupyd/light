import type { WebRTCAdapter } from './types.js';

let customAdapter: WebRTCAdapter | null = null;

/**
 * Explicitly set a global WebRTC adapter (useful for custom polyfills).
 */
export function setWebRTCAdapter(adapter: WebRTCAdapter): void {
  customAdapter = adapter;
}

/**
 * Get WebRTC implementation adapter.
 * Fallbacks in order:
 * 1. User-provided adapter (arg or setWebRTCAdapter)
 * 2. Browser native global RTCPeerConnection
 * 3. Node/Bun werift WebRTC package
 */
export function getWebRTCAdapter(overrideAdapter?: WebRTCAdapter): WebRTCAdapter {
  if (overrideAdapter) {
    return overrideAdapter;
  }

  if (customAdapter) {
    return customAdapter;
  }

  if (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.RTCPeerConnection !== 'undefined' &&
    typeof globalThis.RTCSessionDescription !== 'undefined' &&
    typeof globalThis.RTCIceCandidate !== 'undefined'
  ) {
    return {
      RTCPeerConnection: globalThis.RTCPeerConnection,
      RTCSessionDescription: globalThis.RTCSessionDescription,
      RTCIceCandidate: globalThis.RTCIceCandidate,
    };
  }

  // Node.js / Bun runtime fallback using werift
  try {
    const req = typeof require !== 'undefined' ? require : (globalThis as any).require;
    if (typeof req === 'function') {
      const werift = req('werift');
      return {
        RTCPeerConnection: werift.RTCPeerConnection,
        RTCSessionDescription: werift.RTCSessionDescription,
        RTCIceCandidate: werift.RTCIceCandidate,
      };
    }
  } catch (err) {
    // Handled below
  }
  throw new Error(
    'WebRTC is not available natively in this environment and "werift" could not be loaded. ' +
      'Please pass a WebRTC implementation via options.webrtc or call setWebRTCAdapter().'
  );
}
