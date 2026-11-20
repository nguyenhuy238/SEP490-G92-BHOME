import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { Agent } from 'node:https';
import { validateWebEnvironment } from '../../packages/client-core/viteEnvironment.ts';

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const target = validateWebEnvironment(
    {
      ...env,
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    },
    command === 'build',
  );
  // Trust the workstation CA and standalone localhost certificate when present.
  const certificateDirectory = new URL('../../.tools/mobile-tls/', import.meta.url);
  const certificates = [
    ...['localhost.cer', 'root-ca.cer'].map((name) =>
      fileURLToPath(new URL(name, certificateDirectory)),
    ),
    ...(process.env.VITE_DEV_CA_FILE ? [process.env.VITE_DEV_CA_FILE] : []),
    fileURLToPath(new URL('../../.tools/team-tls/localhost.pem', import.meta.url)),
  ]
    .filter(existsSync)
    .map((path) => new X509Certificate(readFileSync(path)).toString());
  const agent =
    target.protocol === 'https:' && target.hostname === 'localhost' && certificates.length
      ? new Agent({ ca: certificates })
      : undefined;
  const https = process.env.BHOME_WEB_HTTPS === 'true';
  const pem = new URL('../../.tools/team-tls/localhost.pem', import.meta.url);
  const key = new URL('../../.tools/team-tls/localhost.key', import.meta.url);
  if (https && (!existsSync(pem) || !existsSync(key)))
    throw new Error(
      'Run scripts/Initialize-TeamEnvironment.ps1 after trusting dotnet dev-certs https.',
    );
  return {
    plugins: [react()],
    // Same-origin browser cookies retain Secure/HttpOnly/SameSite=Strict. The API
    // remains HTTPS and its certificate is verified; never set secure:false.
    server: {
      host: 'localhost',
      port: https ? 5176 : 5173,
      strictPort: true,
      https: https ? { cert: readFileSync(pem), key: readFileSync(key) } : undefined,
      proxy: {
        '/api': { target: target.origin, changeOrigin: true, secure: true, agent },
        '/open/sign-contract': { target: target.origin, changeOrigin: true, secure: true, agent },
      },
    },
  };
});
