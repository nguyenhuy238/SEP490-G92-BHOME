import { useRef, useState } from 'react';
import { usePropertySetupApi } from './usePropertySetupApi';

export type UtilityValues = Record<string, string>;
export const utilityTypes = [
  { id: '0', label: 'Điện' },
  { id: '1', label: 'Nước' },
];
export function periodStart(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('A valid billing month is required.');
  return `${value}-01`;
}
export function setupDecimal(value: string | number) {
  const [whole, fraction] = String(value).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction ? ',' + fraction : '');
}
export function usePrivateSetupEvidence(locationId: string) {
  const api = usePropertySetupApi();
  const [file, setFile] = useState<File | null>(null);
  const uploaded = useRef<{ file: File; key: string } | null>(null);
  return {
    file,
    setFile,
    getKey: async () => {
      if (!file) throw new Error('Evidence must be selected.');
      if (uploaded.current?.file !== file)
        uploaded.current = { file, key: (await api.uploadEvidence(locationId, file)).objectKey };
      return uploaded.current.key;
    },
  };
}
