/** Upload small private-photo batches with bounded network overlap.
 *
 * Wait for every in-flight result before reporting a failure. Successful
 * uploads remain server-side and keep their existing idempotency keys on retry.
 * The caller must read the latest task version before writing evidence links.
 */
export async function uploadPhotosBounded<T, R>(
  photos: readonly T[],
  upload: (photo: T) => Promise<R>,
): Promise<R[]> {
  if (!photos.length) return [];
  const results: R[] = new Array(photos.length);
  const failures: unknown[] = [];
  let next = 0;
  let stopped = false;
  await Promise.all(
    Array.from({ length: Math.min(2, photos.length) }, async () => {
      while (!stopped && next < photos.length) {
        const index = next++;
        try {
          results[index] = await upload(photos[index]);
        } catch (cause) {
          stopped = true;
          failures.push(cause);
        }
      }
    }),
  );
  if (failures.length) throw failures[0];
  return results;
}
