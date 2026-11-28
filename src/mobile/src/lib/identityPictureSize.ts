// Device-reported photo dimensions only. Preserve native detail within the API's
// pixel budget; this never labels a device as macro-capable or changes its lens.
export function identityPictureSize(sizes: string[]): string | undefined {
  const candidates = sizes.flatMap((value) => {
    const match = /^(\d+)x(\d+)$/.exec(value);
    if (!match) return [];
    const pixels = Number(match[1]) * Number(match[2]);
    return Number.isSafeInteger(pixels) && pixels > 0 ? [{ value, pixels }] : [];
  });
  const pixelBudget = 12_000_000;
  const bounded = candidates
    .filter((item) => item.pixels <= pixelBudget)
    .sort((a, b) => b.pixels - a.pixels)[0];
  const oversized = candidates
    .filter((item) => item.pixels > pixelBudget)
    .sort((a, b) => a.pixels - b.pixels)[0];
  // Common 4032x3024 photos slightly exceed 12 MP. Prefer their detail
  // over a much smaller preset; prepareCapture already bounds the upload.
  // Do not select a huge native image solely to downsample it.
  if (
    oversized &&
    oversized.pixels <= pixelBudget * 1.1 &&
    (!bounded || bounded.pixels < pixelBudget * 0.9)
  )
    return oversized.value;
  return bounded?.value ?? oversized?.value;
}
