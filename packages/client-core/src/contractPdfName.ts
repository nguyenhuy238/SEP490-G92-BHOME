export function contractPdfName(kind: string | undefined, id: string) {
  const prefix =
    kind === 'Holding'
      ? 'Hop-dong-dat-coc'
      : kind === 'Addendum'
        ? 'Phu-luc-hop-dong'
        : kind === 'Main'
          ? 'Hop-dong-thue-phong'
          : 'Hop-dong';
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  return safe ? `${prefix}-${safe}.pdf` : `${prefix}.pdf`;
}
