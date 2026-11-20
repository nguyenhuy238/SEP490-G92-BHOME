import { describe, expect, it } from 'vitest';
import { validateWebEnvironment } from '../../../../packages/client-core/viteEnvironment';

describe('environment build boundary', () => {
  it('rejects the legacy API as the base of a new Staging release', () => {
    expect(() =>
      validateWebEnvironment(
        {
          VITE_API_BASE_URL: 'https://api-sepay-test.103.146.23.157.sslip.io',
          VITE_DEPLOYMENT_ENVIRONMENT: 'Staging',
          VITE_API_MODE: 'api',
        },
        true,
      ),
    ).toThrow('does not belong');
  });
  it('supports two independent local developers without tunnels', () => {
    for (const port of [7240, 7241]) {
      expect(
        validateWebEnvironment({ VITE_API_BASE_URL: `https://localhost:${port}` }, false).port,
      ).toBe(String(port));
    }
  });
  it.each([
    'https://localhost:7240',
    'https://127.0.0.1',
    'https://[::1]',
    'https://old.trycloudflare.com',
    'https://old.ngrok-free.dev',
    'http://api.example.invalid',
    'https://user:password@api.example.invalid',
    'api.example.invalid',
  ])('rejects an unsafe deployment API %s', (value) => {
    expect(() => validateWebEnvironment({ VITE_API_BASE_URL: value }, true)).toThrow();
  });
  it.each([
    'VITE_API_TOKEN',
    'VITE_SEPAY_HMAC',
    'VITE_SMTP_PASSWORD',
    'VITE_JWT_SECRET',
    'VITE_API_KEY',
  ])('rejects frontend credential key %s without printing its value', (key) => {
    expect(() => validateWebEnvironment({ [key]: 'SENSITIVE_VALUE' }, false)).toThrow(key);
    try {
      validateWebEnvironment({ [key]: 'SENSITIVE_VALUE' }, false);
    } catch (error) {
      expect(String(error)).not.toContain('SENSITIVE_VALUE');
    }
  });
  it('keeps a staging portal on its own API and accepts sslip/custom deployment hosts', () => {
    for (const origin of [
      'https://api-staging.103.146.23.157.sslip.io',
      'https://owner.bhome.example',
    ]) {
      expect(
        validateWebEnvironment({ VITE_API_BASE_URL: origin, VITE_DEPLOYMENT_ORIGIN: origin }, true)
          .origin,
      ).toBe(origin);
    }
    expect(() =>
      validateWebEnvironment(
        {
          VITE_API_BASE_URL: 'https://owner.production.example',
          VITE_DEPLOYMENT_ORIGIN: 'https://owner.stage.example',
        },
        true,
      ),
    ).toThrow('match');
  });
  it('requires an explicit API for a build', () => {
    expect(() => validateWebEnvironment({}, true)).toThrow('required');
  });
  it.each([
    ['Production', 'https://api-staging.103.146.23.157.sslip.io'],
    ['Staging', 'https://api.103.146.23.157.sslip.io'],
  ])('rejects a cross-environment API in %s', (environment, api) => {
    expect(() =>
      validateWebEnvironment(
        { VITE_API_BASE_URL: api, VITE_DEPLOYMENT_ENVIRONMENT: environment, VITE_API_MODE: 'api' },
        true,
      ),
    ).toThrow('does not belong');
  });
  it('requires API mode for environment-specific artifacts', () => {
    expect(() =>
      validateWebEnvironment(
        {
          VITE_API_BASE_URL: 'https://owner.103.146.23.157.sslip.io',
          VITE_DEPLOYMENT_ENVIRONMENT: 'Production',
        },
        true,
      ),
    ).toThrow('explicit');
  });
  it('does not expose malformed URL credentials', () => {
    expect(() =>
      validateWebEnvironment({ VITE_API_BASE_URL: 'https://user:SENSITIVE_VALUE@' }, true),
    ).toThrow('value withheld');
    try {
      validateWebEnvironment({ VITE_API_BASE_URL: 'https://user:SENSITIVE_VALUE@' }, true);
    } catch (error) {
      expect(String(error)).not.toContain('SENSITIVE_VALUE');
    }
  });
});
