import { describe, expect, it } from 'vitest';
import { formatMeterReading } from '../../../../packages/client-core/src/localization';

describe('formatMeterReading Vietnamese number formatting', () => {
  it('formats raw 55555.0000 to 55.555 without trailing zeros', () => {
    expect(formatMeterReading('55555.0000')).toBe('55.555');
    expect(formatMeterReading('55555.0000', 'kWh')).toBe('55.555 kWh');
  });

  it('formats raw 65555.0000 to 65.555 without trailing zeros', () => {
    expect(formatMeterReading('65555.0000')).toBe('65.555');
    expect(formatMeterReading('65555.0000', 'm³')).toBe('65.555 m³');
  });

  it('formats 1234.5000 to 1.234,5 preserving meaningful decimal digits and removing trailing zeros', () => {
    expect(formatMeterReading('1234.5000')).toBe('1.234,5');
    expect(formatMeterReading('1234.5000', 'kWh')).toBe('1.234,5 kWh');
  });

  it('formats 1234.5678 to 1.234,5678 without rounding to integer', () => {
    expect(formatMeterReading('1234.5678')).toBe('1.234,5678');
    expect(formatMeterReading('1234.5678', 'm³')).toBe('1.234,5678 m³');
  });

  it('formats 150.0000 to 150 omitting decimal separator when fractional part is zero', () => {
    expect(formatMeterReading('150.0000')).toBe('150');
    expect(formatMeterReading('150.0000', 'kWh')).toBe('150 kWh');
    expect(formatMeterReading(150, 'kWh')).toBe('150 kWh');
  });

  it('formats 0.0000 to 0', () => {
    expect(formatMeterReading('0.0000')).toBe('0');
    expect(formatMeterReading('0.0000', 'kWh')).toBe('0 kWh');
    expect(formatMeterReading(0)).toBe('0');
    expect(formatMeterReading('0')).toBe('0');
  });

  it('handles partial fractions with leading zero like 0.0500', () => {
    expect(formatMeterReading('0.0500')).toBe('0,05');
    expect(formatMeterReading('0.0500', 'm³')).toBe('0,05 m³');
  });

  it('handles very large readings with multiple thousand dots', () => {
    expect(formatMeterReading('123456789.5')).toBe('123.456.789,5');
    expect(formatMeterReading('123456789.5', 'kWh')).toBe('123.456.789,5 kWh');
  });

  it('handles negative numbers safely if encountered', () => {
    expect(formatMeterReading('-1234.5000')).toBe('-1.234,5');
  });

  it('handles null, undefined and empty string gracefully', () => {
    expect(formatMeterReading(null)).toBe('');
    expect(formatMeterReading(undefined)).toBe('');
    expect(formatMeterReading('')).toBe('');
    expect(formatMeterReading(null, 'kWh')).toBe('');
  });

  it('handles comma-separated decimal string inputs gracefully', () => {
    expect(formatMeterReading('1234,5000')).toBe('1.234,5');
  });
});
