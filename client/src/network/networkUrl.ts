export type NetworkLocation = Readonly<{
  protocol: string;
  host: string;
}>;

/** Resolves an explicit server URL or a same-origin WebSocket endpoint. */
export function resolveNetworkUrl(
  configuredUrl: string | undefined,
  location: NetworkLocation,
): string {
  const explicitUrl = configuredUrl?.trim();
  if (explicitUrl !== undefined && explicitUrl.length > 0) return explicitUrl;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

/** Resolves the WebSocket endpoint for the current browser application. */
export function getNetworkUrl(): string {
  return resolveNetworkUrl(import.meta.env.VITE_NETWORK_URL, window.location);
}
