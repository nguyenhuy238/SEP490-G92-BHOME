// Sort exact server decimal strings, including signed amounts and fractional ratios.
export function compareDecimal(a: string, b: string): number {
  const parse = (s: string) => {
    const [whole, fraction = ''] = s.replace(/^-/, '').split('.');
    return {
      digits: BigInt(whole + fraction),
      scale: fraction.length,
      negative: s.startsWith('-'),
    };
  };
  const x = parse(a),
    y = parse(b);
  const scale = Math.max(x.scale, y.scale);
  const left = x.digits * 10n ** BigInt(scale - x.scale) * (x.negative ? -1n : 1n);
  const right = y.digits * 10n ** BigInt(scale - y.scale) * (y.negative ? -1n : 1n);
  return left < right ? -1 : left > right ? 1 : 0;
}
