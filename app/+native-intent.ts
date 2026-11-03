import { getShareExtensionKey } from "expo-share-intent";

/**
 * The share extension opens the app with lastleg://dataUrl=<key>?nonce=...
 * Route that to the share screen instead of letting the router 404 on it.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return "/share";
    return path;
  } catch {
    return "/";
  }
}
