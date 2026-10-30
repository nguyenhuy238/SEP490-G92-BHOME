import { Directory, File, Paths } from 'expo-file-system';

export function captureDirectory() {
  const directory = new Directory(Paths.cache, 'bhome-ocr');
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}
export function ownCapture(uri: string) {
  const file = new File(uri);
  if (!uri.startsWith(Paths.cache.uri)) throw new Error('Capture is outside application cache.');
  const target = new File(
    captureDirectory(),
    `capture-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`,
  );
  file.move(target);
  return target.uri;
}
export function clearAbandonedCaptures() {
  // Only the app's temporary capture/download caches, never the photo library.
  for (const name of ['bhome-ocr', 'ImageManipulator', 'bhome-contract-downloads']) {
    const directory = new Directory(Paths.cache, name);
    if (directory.exists) directory.delete();
  }
}
