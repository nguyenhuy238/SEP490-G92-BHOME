import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { validateWebEnvironment } from '../../packages/client-core/viteEnvironment.ts';
import { existsSync, readFileSync } from 'node:fs';
import { Agent } from 'node:https';

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
  const certificate = new URL('../../.tools/team-tls/localhost.pem', import.meta.url);
  const agent =
    target.hostname === 'localhost' && existsSync(certificate)
      ? new Agent({ ca: readFileSync(certificate) })
      : undefined;
  return {
    plugins: [react()],
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': {
          target: target.origin,
          changeOrigin: true,
          secure: true,
          agent,
        },
      },
    },
  };
});
