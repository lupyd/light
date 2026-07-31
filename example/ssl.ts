import selfsigned from 'selfsigned';

export interface SSLCertificate {
  cert: string;
  key: string;
}

let cachedCert: SSLCertificate | null = null;

/**
 * Generate or return cached dummy SSL certificate and key on the fly.
 */
export async function getDummySSLCertificate(): Promise<SSLCertificate> {
  if (cachedCert) {
    return cachedCert;
  }

  console.log('🔒 Generating dummy self-signed SSL certificate on the fly...');

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pkey = await selfsigned.generate(attrs, {
    keySize: 2048,
    days: 365,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: '0.0.0.0' },
        ],
      },
    ],
  });

  cachedCert = {
    cert: pkey.cert,
    key: pkey.private,
  };

  return cachedCert;
}

/**
 * Configure Node / Bun process to accept self-signed certificates for CLI clients.
 */
export function allowSelfSignedCertificates(): void {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
