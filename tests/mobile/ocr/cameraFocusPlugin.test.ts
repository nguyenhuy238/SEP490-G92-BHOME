import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { patchCamera } = require('../../../scripts/mobile/withCameraFocus.cjs') as {
  patchCamera: (root: string, platform: 'ios' | 'android') => void;
};
const cameraRoot = path.dirname(require.resolve('expo-camera/package.json'));
const sources = [
  'ios/CameraViewModule.swift',
  'ios/Current/CameraView.swift',
  'android/src/main/java/expo/modules/camera/CameraViewModule.kt',
  'android/src/main/java/expo/modules/camera/ExpoCameraView.kt',
];
let fixture = '';
beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bhome-focus-plugin-'));
  fs.copyFileSync(path.join(cameraRoot, 'package.json'), path.join(fixture, 'package.json'));
  for (const source of sources) {
    fs.mkdirSync(path.dirname(path.join(fixture, source)), { recursive: true });
    fs.copyFileSync(path.join(cameraRoot, source), path.join(fixture, source));
  }
});
afterEach(() => {
  const target = path.resolve(fixture);
  if (
    path.dirname(target) !== path.resolve(os.tmpdir()) ||
    !path.basename(target).startsWith('bhome-focus-plugin-')
  )
    throw new Error('Unsafe fixture cleanup');
  fs.rmSync(target, { recursive: true, force: true });
});
it.each(['ios', 'android'] as const)(
  'applies %s focus integration idempotently to Expo camera',
  (platform) => {
    patchCamera(fixture, platform);
    const first = sources.map((source) => fs.readFileSync(path.join(fixture, source), 'utf8'));
    patchCamera(fixture, platform);
    expect(sources.map((source) => fs.readFileSync(path.join(fixture, source), 'utf8'))).toEqual(
      first,
    );
    const module = first[platform === 'ios' ? 0 : 2];
    expect(module.match(/Property\("bhomeFocusVersion"\)/g)).toHaveLength(1);
    expect(module.match(/Prop\("bhomeFocusEnabled"\)/g)).toHaveLength(1);
    expect(module).toContain('onBhomeFocusChanged');
    const helper =
      platform === 'ios'
        ? 'ios/Current/BhomeCameraFocus.swift'
        : 'android/src/main/java/expo/modules/camera/BhomeCameraFocus.kt';
    expect(fs.existsSync(path.join(fixture, helper))).toBe(true);
  },
);
it('rejects an unreviewed camera version before modifying any source', () => {
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ version: '58.0.15' }));
  const before = sources.map((source) => fs.readFileSync(path.join(fixture, source), 'utf8'));
  expect(() => patchCamera(fixture, 'android')).toThrow('requires reviewed expo-camera');
  expect(sources.map((source) => fs.readFileSync(path.join(fixture, source), 'utf8'))).toEqual(
    before,
  );
});
it.each(['ios', 'android'] as const)(
  'fails atomically if the second %s file has an upstream conflict',
  (platform) => {
    const index = platform === 'ios' ? 0 : 2;
    fs.appendFileSync(path.join(fixture, sources[index + 1]), '\n// Simulated upstream change\n');
    const before = fs.readFileSync(path.join(fixture, sources[index]), 'utf8');
    expect(() => patchCamera(fixture, platform)).toThrow('upstream source changed');
    expect(fs.readFileSync(path.join(fixture, sources[index]), 'utf8')).toBe(before);
  },
);
