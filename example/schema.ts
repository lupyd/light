const enc = new TextEncoder();
const dec = new TextDecoder();

export const encodeJson = (val: any): Uint8Array => enc.encode(JSON.stringify(val ?? null));
export const decodeJson = <T = any>(bytes: Uint8Array): T => {
  if (!bytes || bytes.length === 0) return null as any;
  return JSON.parse(dec.decode(bytes));
};

// Binary RPC schemas taking Uint8Array input and returning Uint8Array
export type CommonPeerSchema = {
  ping: (data: Uint8Array) => Uint8Array;
  echo: (data: Uint8Array) => Uint8Array;
  add: (data: Uint8Array) => Uint8Array;
  getSystemInfo: (data: Uint8Array) => Uint8Array;
  fetchQuote: (data: Uint8Array) => Uint8Array;
};

export type ClientASchema = {
  getSystemInfo: (data: Uint8Array) => Uint8Array;
  calculateSum: (data: Uint8Array) => Uint8Array;
  echo: (data: Uint8Array) => Uint8Array;
};

export type ClientBSchema = {
  greetUser: (data: Uint8Array) => Uint8Array;
  processData: (data: Uint8Array) => Uint8Array;
  ping: (data: Uint8Array) => Uint8Array;
};
