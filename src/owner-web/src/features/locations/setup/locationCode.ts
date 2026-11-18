/** Initial suggestion only; the API assigns a unique suffix when saving. */
export function suggestedLocationCode(name: string): string {
  const latin = name
    .replace(/[đĐ]/g, (letter) => (letter === 'đ' ? 'd' : 'D'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const initials = latin
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .join('');
  return initials.slice(0, 42) || 'CS';
}
