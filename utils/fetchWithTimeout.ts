const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  url: string,
  options?: { timeoutMs?: number }
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await globalThis.fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
}
