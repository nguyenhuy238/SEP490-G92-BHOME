// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const flatten = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten))
    : style && typeof style === 'object'
      ? (style as Record<string, unknown>)
      : {};
vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s },
  Platform: { OS: 'android', select: (v: Record<string, unknown>) => v.android ?? v.default },
  View: ({ children, style }: { children?: React.ReactNode; style?: unknown }) => (
    <div data-rn-style={JSON.stringify(flatten(style))}>{children}</div>
  ),
}));
vi.mock('react-native-paper', async () => {
  const { default: configureFonts } =
    await import('../../../../node_modules/react-native-paper/src/styles/fonts');
  return {
    configureFonts,
    MD3LightTheme: { colors: {} },
    useTheme: () => ({ colors: { surface: '#fff', onSurfaceVariant: '#64748b' } }),
    Icon: ({ source, size }: { source: string; size: number }) => (
      <i data-icon={source} data-size={size} />
    ),
    Text: ({
      children,
      variant,
      style,
    }: {
      children?: React.ReactNode;
      variant?: keyof typeof theme.fonts;
      style?: unknown;
    }) => (
      <span
        data-rn-style={JSON.stringify({ ...theme.fonts[variant ?? 'default'], ...flatten(style) })}
      >
        {children}
      </span>
    ),
    TouchableRipple: ({
      children,
      accessibilityLabel,
      onPress,
    }: {
      children?: React.ReactNode;
      accessibilityLabel: string;
      onPress: () => void;
    }) => (
      <button aria-label={accessibilityLabel} onClick={onPress}>
        {children}
      </button>
    ),
  };
});
vi.mock('../features/workspace/WorkspaceProvider', () => ({
  useWorkspace: () => ({ go: vi.fn() }),
}));
import { theme } from '../theme/theme';
import { typography, fontFaces } from '../theme/typography';
import { StaffFeatureCard } from '../components/StaffFeatureCard';
import { TenantFeatureDirectory } from '../components/TenantFeatureDirectory';
afterEach(cleanup);
const styleOf = (node: Element | null) => JSON.parse(node?.getAttribute('data-rn-style') ?? '{}');
it('uses loaded static Inter faces for every Paper slot, including unvarianted text', () => {
  for (const font of Object.values(theme.fonts)) {
    expect(Object.values(fontFaces)).toContain(font.fontFamily);
    expect(font.fontWeight).toBe('normal');
    expect(font.letterSpacing).toBe(0);
  }
  expect(theme.fonts.default.fontFamily).toBe(fontFaces.regular);
  expect(typography.screenTitle.fontFamily).toBe(fontFaces.bold);
  expect(typography.money.fontSize).toBeGreaterThan(typography.cardTitle.fontSize);
});
it('centers the whole Tenant tile group and matches the Staff compact icon/title conventions', () => {
  render(
    <>
      <StaffFeatureCard
        compact
        title="Staff reference"
        description="Mô tả tham chiếu"
        icon="home-outline"
        color="#2563EB"
        background="#E8F0FE"
        onPress={() => {}}
      />
      <TenantFeatureDirectory all />
    </>,
  );
  const reference = screen.getByRole('button', { name: 'Staff reference' });
  const staffIcon = reference.querySelector('i')!;
  const staffIconStyle = styleOf(staffIcon.parentElement);
  const staffTitle = styleOf(screen.getByText('Staff reference'));
  const tenantButtons = screen.getAllByRole('button').filter((button) => button !== reference);
  expect(tenantButtons).toHaveLength(11);
  for (const button of tenantButtons) {
    const icon = button.querySelector('i')!;
    const iconStyle = styleOf(icon.parentElement);
    const groupStyle = styleOf(icon.parentElement?.parentElement ?? null);
    expect(groupStyle.alignItems).toBe('center');
    expect(groupStyle.justifyContent).toBe('center');
    expect(iconStyle).toMatchObject({
      width: staffIconStyle.width,
      height: staffIconStyle.height,
      borderRadius: staffIconStyle.borderRadius,
      alignItems: 'center',
      justifyContent: 'center',
    });
    expect(icon.getAttribute('data-size')).toBe(staffIcon.getAttribute('data-size'));
    const titleStyle = styleOf(button.querySelector('span'));
    expect(titleStyle).toMatchObject({
      fontFamily: staffTitle.fontFamily,
      fontSize: staffTitle.fontSize,
      fontWeight: staffTitle.fontWeight,
      lineHeight: staffTitle.lineHeight,
      letterSpacing: staffTitle.letterSpacing,
      textAlign: 'center',
    });
  }
});

// Check the actual bundled TTFs, not a mocked claim of Vietnamese support.
function fontEvidence(data: Buffer) {
  const tables = new Map<string, number>();
  for (let n = 0; n < data.readUInt16BE(4); n++) {
    const p = 12 + n * 16;
    tables.set(data.toString('ascii', p, p + 4), data.readUInt32BE(p + 8));
  }
  const cmap = tables.get('cmap')!;
  const subtables: number[] = [];
  for (let n = 0; n < data.readUInt16BE(cmap + 2); n++) {
    const p = cmap + 4 + n * 8;
    const platform = data.readUInt16BE(p);
    if (platform === 0 || platform === 3) subtables.push(cmap + data.readUInt32BE(p + 4));
  }
  function hasGlyph(cp: number) {
    return subtables.some((p) => {
      const format = data.readUInt16BE(p);
      if (format === 12) {
        for (let n = 0; n < data.readUInt32BE(p + 12); n++) {
          const group = p + 16 + n * 12,
            start = data.readUInt32BE(group),
            end = data.readUInt32BE(group + 4);
          if (cp >= start && cp <= end) return data.readUInt32BE(group + 8) + cp - start !== 0;
        }
      } else if (format === 4 && cp <= 0xffff) {
        const count = data.readUInt16BE(p + 6) / 2;
        for (let n = 0; n < count; n++) {
          const end = data.readUInt16BE(p + 14 + n * 2),
            start = data.readUInt16BE(p + 16 + count * 2 + n * 2);
          if (cp < start || cp > end) continue;
          const delta = data.readInt16BE(p + 16 + count * 4 + n * 2),
            offsetAddress = p + 16 + count * 6 + n * 2;
          const offset = data.readUInt16BE(offsetAddress);
          const glyph = offset ? data.readUInt16BE(offsetAddress + offset + (cp - start) * 2) : cp;
          return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
        }
      }
      return false;
    });
  }
  return { weight: data.readUInt16BE(tables.get('OS/2')! + 4), hasGlyph };
}
it.each([
  ['Regular', 400],
  ['Medium', 500],
  ['SemiBold', 600],
  ['Bold', 700],
] as const)(
  'bundles the real %s weight with Vietnamese composed and combining glyphs',
  (face, weight) => {
    const file = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/fonts', `Inter-${face}.ttf`),
    );
    const font = fontEvidence(file);
    expect(font.weight).toBe(weight);
    const points = [
      ...'ĂăĐđƠơƯư',
      ...Array.from({ length: 0x1ef9 - 0x1ea0 + 1 }, (_, n) => String.fromCodePoint(0x1ea0 + n)),
      ...'\u0300\u0301\u0302\u0303\u0306\u0309\u031b\u0323',
    ];
    for (const char of points)
      expect(
        font.hasGlyph(char.codePointAt(0)!),
        `Inter-${face} U+${char.codePointAt(0)!.toString(16)}`,
      ).toBe(true);
  },
);
