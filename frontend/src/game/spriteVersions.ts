// Cache-busting for sprite art.
//
// Custom (DB-stored) sprites are served by GET /api/sprites/:name with a
// strong ETag derived from the row's write-version, so browsers revalidate
// with If-None-Match and get a bodyless 304 while art is unchanged. For the
// instant-update path (and the static /sprites/*.png mirror copies) the client
// also appends ?v=<version> — a re-upload changes the version, which changes
// the URL, which bypasses every cache on the way.
//
// The versions map is refreshed from /api/sprites/list; a global nonce bumps
// whenever that refresh happens so previews re-render even for slots whose
// version we have not seen yet.

let versions: Record<string, number> = {};
let nonce = 0;
const listeners = new Set<() => void>();

function qs(v: number | undefined): string {
  return v !== undefined ? `v=${v}` : `r=${nonce}`;
}

/** Custom sprite URL, cache-busted by its content version when known. */
export function spriteApiUrl(name: string): string {
  return `/api/sprites/${encodeURIComponent(name)}.png?${qs(versions[name])}`;
}

/** Static-file sprite URL, cache-busted by version when known. */
export function spriteStaticUrl(name: string): string {
  return `/sprites/${encodeURIComponent(name)}.png?${qs(versions[name])}`;
}

/** Subscribe to version-map changes (used to re-render previews). */
export function onSpriteVersions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Re-fetch the versions map (call after any admin upload/restore, or to learn
 * which custom sprites exist). Resolves with the sprite list + versions once
 * subscribers have been notified; resolves null on network errors — the ETag
 * path still guarantees freshness on revalidate.
 */
export async function refreshSpriteVersions(): Promise<{ sprites: string[]; versions: Record<string, number> } | null> {
  try {
    const res = await fetch('/api/sprites/list');
    if (res.ok) {
      const data = (await res.json()) as { sprites?: string[]; versions?: Record<string, number> };
      versions = data.versions ?? {};
      nonce += 1;
      for (const l of listeners) l();
      return { sprites: data.sprites ?? [], versions };
    }
  } catch {
    // Offline / API hiccup — keep the previous map; ETags still cover freshness.
  }
  return null;
}
