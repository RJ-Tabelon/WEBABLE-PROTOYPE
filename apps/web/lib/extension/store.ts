import { getPublicEnv } from '../env';

/**
 * The Chrome Web Store listing for this build's extension id, or null when no
 * id is configured (then "Add WebAble" goes to /get instead). Safe on the
 * server and in the browser: the id is a NEXT_PUBLIC value inlined at build.
 */
export function chromeStoreUrl(): string | null {
  let extensionId: string | null = null;
  try {
    extensionId = getPublicEnv().extensionId;
  } catch {
    return null;
  }
  return extensionId
    ? `https://chromewebstore.google.com/detail/${extensionId}`
    : null;
}
