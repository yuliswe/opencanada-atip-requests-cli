const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  url: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options ?? {};
  return await globalThis.fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}
