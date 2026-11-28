// Device-reported photo dimensions only. Preserve native detail within the API's
// pixel budget; this never labels a device as macro-capable or changes its lens.
export function identityPictureSize(sizes: string[]): string | undefined {
  const candidates = sizes.flatMap((value) => {
    const match = /^(\d+)x(\d+)$/.exec(value);
    if (!match) return [];
    const pixels = Number(match[1]) * Number(match[2]);
    return Number.isSafeInteger(pixels) && pixels > 0 ? [{ value, pixels }] : [];
  });
  return (
    candidates.filter((item) => item.pixels <= 12_000_000).sort((a, b) => b.pixels - a.pixels)[0]
      ?.value ?? candidates.sort((a, b) => a.pixels - b.pixels)[0]?.value
  );
}
