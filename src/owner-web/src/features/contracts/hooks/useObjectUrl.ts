import { useEffect, useState } from 'react';

// An image fetched through the authenticated API client, as an object URL that is revoked when `id` changes or the
// component unmounts. A late response for an earlier `id` is never shown.
export function useObjectUrl(id: string, load: ((signal: AbortSignal) => Promise<Blob>) | null) {
  const [state, setState] = useState<{ id: string; url: string } | null>(null);
  const enabled = !!load;
  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    let made: string | null = null;
    Promise.resolve()
      .then(() => load(controller.signal))
      .then(
        (blob) => {
          if (controller.signal.aborted) return;
          made = URL.createObjectURL(blob);
          setState({ id, url: made });
        },
        () => {},
      );
    return () => {
      controller.abort();
      if (made) URL.revokeObjectURL(made);
    };
    // `load` is a new closure each render; `id` names what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled]);
  return enabled && state?.id === id ? state.url : null;
}
