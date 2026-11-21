// Authenticated bytes only; never put API credentials or object-storage URLs in navigation.
export function openPdfWindow() {
  const tab = window.open('about:blank', '_blank');
  if (!tab) throw new Error('pdf_popup_blocked');
  tab.opener = null;
  return tab;
}

export function deliverWebDocument(
  bytes: Uint8Array<ArrayBuffer>,
  pdf: boolean,
  filename: string,
  tab?: Window | null,
) {
  const signature = pdf ? [37, 80, 68, 70, 45] : [80, 75, 3, 4];
  if (bytes.length < signature.length || signature.some((value, index) => bytes[index] !== value))
    throw new Error('draft_download_invalid');
  const mime = pdf
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  if (tab) {
    if (tab.closed) {
      URL.revokeObjectURL(url);
      throw new Error('pdf_window_closed');
    }
    try {
      tab.location.replace(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    // Keep the Blob alive while the reader is open (PDF viewers may read lazily).
    const cleanup = () => {
      clearInterval(timer);
      URL.revokeObjectURL(url);
      window.removeEventListener('pagehide', cleanup);
    };
    const timer = setInterval(() => {
      if (tab.closed) cleanup();
    }, 1000);
    window.addEventListener('pagehide', cleanup, { once: true });
  } else {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
