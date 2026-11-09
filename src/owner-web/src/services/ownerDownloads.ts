export async function downloadOwnerFile(
  request: <T>(path: string, init?: RequestInit, type?: 'json' | 'blob' | 'bytes') => Promise<T>,
  path: string,
  name: string,
) {
  const blob = await request<Blob>(path, undefined, 'blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
