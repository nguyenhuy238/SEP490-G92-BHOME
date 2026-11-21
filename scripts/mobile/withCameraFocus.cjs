const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { withDangerousMod } = require('expo/config-plugins');
const nativeSource = path.join(__dirname, '../../src/mobile/plugins/camera-focus');

// Source anchors and hashes belong to expo-camera 58.0.14. Fail before writing
// if the upstream source changes, so a dependency update requires review.
const specifications = {
  ios: [
    {
      file: 'ios/CameraViewModule.swift',
      hash: '383e39a5262a31624039055fbd074e3ce5579883cb26eec12c5d2bccfe60f742',
      replacements: [
        ['"onRecordingProgress"]', '"onRecordingProgress", "onBhomeFocusChanged"]'],
        [
          '    Name("ExpoCamera")',
          '    Name("ExpoCamera")\n    Property("bhomeFocusVersion") { 1 }',
        ],
        [
          '      Prop("flashMode")',
          '      Prop("bhomeFocusEnabled") { (view, enabled: Bool?) in\n        view.bhomeFocus.setEnabled(enabled ?? false)\n      }\n\n      Prop("flashMode")',
        ],
      ],
    },
    {
      file: 'ios/Current/CameraView.swift',
      hash: '9d4625286734f33613008b199a3005af2140f9c29750967cff9a2833dac2e7c7',
      replacements: [
        [
          '  let onCameraReady = EventDispatcher()',
          '  let onBhomeFocusChanged = EventDispatcher()\n  var bhomeFocus: BhomeCameraFocus!\n\n  let onCameraReady = EventDispatcher()',
        ],
        ['    setupPreview()', '    setupPreview()\n    bhomeFocus = BhomeCameraFocus(view: self)'],
        [
          '  func emitAvailableLenses() {',
          '  func emitAvailableLenses() {\n    bhomeFocus.refresh()',
        ],
        [
          '  public override func removeFromSuperview() {',
          '  public override func removeFromSuperview() {\n    bhomeFocus.stop()',
        ],
      ],
    },
  ],
  android: [
    {
      file: 'android/src/main/java/expo/modules/camera/CameraViewModule.kt',
      hash: 'dcba7a20d461aa226ca1030d4e851229d39b9a1ee3b672e4b1cb3f062609900a',
      replacements: [
        ['  "onRecordingProgress"\n)', '  "onRecordingProgress",\n  "onBhomeFocusChanged"\n)'],
        [
          '    Name("ExpoCamera")',
          '    Name("ExpoCamera")\n    Property("bhomeFocusVersion") { 1 }',
        ],
        [
          '      Prop("facing")',
          '      Prop("bhomeFocusEnabled") { view, enabled: Boolean? ->\n        view.bhomeFocus.setEnabled(enabled ?: false)\n      }\n\n      Prop("facing")',
        ],
      ],
    },
    {
      file: 'android/src/main/java/expo/modules/camera/ExpoCameraView.kt',
      hash: 'f212cf1f9509e3c52a31fc82bfa8f20f0a29c8266b9ed41b399a626087061abd',
      replacements: [
        [
          '  private val scope = CoroutineScope(',
          '  private val onBhomeFocusChanged by EventDispatcher<Map<String, Any>>()\n  internal val bhomeFocus by lazy {\n    BhomeCameraFocus(previewView, { camera }) { onBhomeFocusChanged(it) }\n  }\n\n  private val scope = CoroutineScope(',
        ],
        [
          '          onCameraReady(Unit)',
          '          bhomeFocus.refresh()\n          onCameraReady(Unit)',
        ],
        ['  fun cleanupCamera() {', '  fun cleanupCamera() {\n    bhomeFocus.dispose()'],
      ],
    },
  ],
};

function digest(source) {
  return createHash('sha256').update(source).digest('hex');
}

function patchCamera(cameraRoot, platform) {
  const version = JSON.parse(
    fs.readFileSync(path.join(cameraRoot, 'package.json'), 'utf8'),
  ).version;
  if (version !== '58.0.14')
    throw new Error(`Camera focus requires reviewed expo-camera 58.0.14, found ${version}`);
  const writes = specifications[platform].map(({ file, hash, replacements }) => {
    const target = path.join(cameraRoot, file);
    let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    // Reverse only our exact additions to validate the upstream source on repeat runs.
    for (const [before, after] of [...replacements].reverse())
      source = source.replace(after, before);
    if (digest(source) !== hash) throw new Error(`Camera focus upstream source changed: ${file}`);
    for (const [before, after] of replacements) {
      if (source.split(before).length !== 2)
        throw new Error(`Camera focus anchor mismatch: ${file}`);
      source = source.replace(before, after);
    }
    return { target, source };
  });
  const helper = platform === 'ios' ? 'BhomeCameraFocus.swift' : 'BhomeCameraFocus.kt';
  const folder = platform === 'ios' ? 'ios/Current' : 'android/src/main/java/expo/modules/camera';
  writes.push({
    target: path.join(cameraRoot, folder, helper),
    source: fs.readFileSync(path.join(nativeSource, helper), 'utf8'),
  });
  if (platform === 'android') {
    writes.push({
      target: path.join(
        cameraRoot,
        'android/src/test/java/expo/modules/camera/BhomeCameraFocusTest.kt',
      ),
      source: fs.readFileSync(path.join(nativeSource, 'BhomeCameraFocusTest.kt'), 'utf8'),
    });
  }
  for (const { target, source } of writes) {
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === source) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
}

function withCameraFocus(config) {
  for (const platform of ['ios', 'android']) {
    config = withDangerousMod(config, [
      platform,
      (mod) => {
        const packageFile = require.resolve('expo-camera/package.json', {
          paths: [mod.modRequest.projectRoot],
        });
        patchCamera(path.dirname(packageFile), platform);
        return mod;
      },
    ]);
  }
  return config;
}

module.exports = withCameraFocus;
module.exports.patchCamera = patchCamera;
