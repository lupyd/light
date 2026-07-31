// Schema for generic peers in CLI or Web
export type CommonPeerSchema = {
  ping: () => string;
  echo: (message: string) => string;
  add: (a: number, b: number) => number;
  getSystemInfo: () => { platform: string; userAgent?: string; uptime: number; timestamp: number };
  fetchQuote: () => { quote: string; author: string };
};

// Define RPC schema for Client A
export type ClientASchema = {
  getSystemInfo: () => { platform: string; uptime: number };
  calculateSum: (numbers: number[]) => number;
  echo: (msg: string) => string;
};

// Define RPC schema for Client B
export type ClientBSchema = {
  greetUser: (name: string) => string;
  processData: (input: { id: string; data: string }) => { processed: boolean; hash: string };
  ping: () => string;
};
