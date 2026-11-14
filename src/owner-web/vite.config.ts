import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { Agent } from 'node:https';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const target = new URL(
    process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL || 'https://localhost:7240',
  );
  if (
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    (target.protocol !== 'https:' &&
      !(
        target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
      ))
  )
    throw new Error(
      'Development API proxy requires HTTPS or an isolated loopback HTTP test server.',
    );
  // Trust the workstation CA and standalone localhost certificate when present.
  const certificateDirectory = new URL('../../.tools/mobile-tls/', import.meta.url);
  const certificates = ['localhost.cer', 'root-ca.cer']
    .map((name) => fileURLToPath(new URL(name, certificateDirectory)))
    .filter(existsSync)
    .map((path) => new X509Certificate(readFileSync(path)).toString());
  const agent =
    target.protocol === 'https:' && target.hostname === 'localhost' && certificates.length
      ? new Agent({ ca: certificates })
      : undefined;
  return {
    plugins: [react()],
    // Same-origin browser cookies retain Secure/HttpOnly/SameSite=Strict. The API
    // remains HTTPS and its certificate is verified; never set secure:false.
    server: {
      proxy: { '/api': { target: target.origin, changeOrigin: true, secure: true, agent } },
    },
  };
});
