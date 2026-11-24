import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { UserFeedbackError } from '../../../../packages/client-core/src/api';
import { randomUUID } from './randomUUID';

/** Private image resources live only while displayed; never persist across navigation or API sessions. */
type PrivatePhoto = { uri: string; dispose: () => void };
type PhotoResponse = Blob | Uint8Array;
type Loader = (signal: AbortSignal) => Promise<PhotoResponse>;
type Entry = {
  refs: number;
  controller: AbortController;
  load: Loader;
  resolve: (uri: string) => void;
  reject: (reason: unknown) => void;
  promise: Promise<string>;
  resource?: PrivatePhoto;
  settled: boolean;
};

// Weak API identity prevents one authenticated session's photos from being
// reused by another. Path/contract/evidence kind are part of the caller's key.
const sessions = new WeakMap<object, Map<string, Entry>>();
const waiting: Entry[] = [];
const maxConcurrentPrivatePhotoLoads = 4;
let loading = 0;

function imageExtension(bytes: Uint8Array): 'png' | 'jpg' {
  if (bytes.length > 5 * 1024 * 1024) throw new UserFeedbackError('Ảnh vượt quá 5 MB.');
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  throw new UserFeedbackError('Ảnh không phải PNG/JPEG hợp lệ.');
}

async function createPrivatePhoto(
  response: PhotoResponse,
  signal: AbortSignal,
): Promise<PrivatePhoto> {
  if (signal.aborted) throw new Error('Photo no longer visible.');
  if (Platform.OS === 'web') {
    const blob = response as Blob;
    if (blob.size > 5 * 1024 * 1024) throw new UserFeedbackError('Ảnh vượt quá 5 MB.');
    const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    const extension = imageExtension(bytes);
    if (signal.aborted) throw new Error('Photo no longer visible.');
    const mime = extension === 'png' ? 'image/png' : 'image/jpeg';
    // A correctly typed verified Blob needs no extra multi-megabyte allocation.
    const url = URL.createObjectURL(blob.type === mime ? blob : new Blob([blob], { type: mime }));
    return { uri: url, dispose: () => URL.revokeObjectURL(url) };
  }
  const bytes = response as Uint8Array;
  const extension = imageExtension(bytes);
  const directory = new Directory(Paths.cache, 'bhome-private-photo-thumbnails');
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, `${randomUUID()}.${extension}`);
  file.create();
  try {
    await file.write(bytes);
    if (signal.aborted) throw new Error('Photo no longer visible.');
    return {
      uri: file.uri,
      dispose: () => {
        if (file.exists) file.delete();
      },
    };
  } catch (cause) {
    if (file.exists) file.delete();
    throw cause;
  }
}

function startWaiting() {
  while (loading < maxConcurrentPrivatePhotoLoads && waiting.length > 0) {
    const entry = waiting.shift()!;
    if (!entry.refs || entry.controller.signal.aborted) continue;
    loading++;
    void Promise.resolve()
      .then(() => entry.load(entry.controller.signal))
      .then((response) => createPrivatePhoto(response, entry.controller.signal))
      .then(
        (photo) => {
          if (!entry.refs || entry.controller.signal.aborted) {
            photo.dispose();
            return;
          }
          entry.resource = photo;
          entry.settled = true;
          entry.resolve(photo.uri);
        },
        (cause) => {
          if (!entry.settled) {
            entry.settled = true;
            entry.reject(cause);
          }
        },
      )
      .finally(() => {
        loading--;
        startWaiting();
      });
  }
}

/** De-duplicate only actively displayed photos; last release aborts and erases private data. */
export function acquirePrivatePhotoThumbnail(api: object, key: string, load: Loader) {
  let cache = sessions.get(api);
  if (!cache) {
    cache = new Map();
    sessions.set(api, cache);
  }
  let entry = cache.get(key);
  if (!entry) {
    let resolve!: (uri: string) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<string>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    entry = {
      refs: 0,
      controller: new AbortController(),
      load,
      resolve,
      reject,
      promise,
      settled: false,
    };
    cache.set(key, entry);
    waiting.push(entry);
  }
  entry.refs++;
  startWaiting();
  const resource = entry;
  let released = false;
  return {
    uri: resource.promise,
    release: () => {
      if (released) return;
      released = true;
      resource.refs--;
      if (resource.refs > 0) return;
      cache.delete(key);
      resource.controller.abort();
      resource.resource?.dispose();
      if (!resource.settled) {
        resource.settled = true;
        resource.reject(new Error('Photo no longer visible.'));
      }
    },
  };
}
