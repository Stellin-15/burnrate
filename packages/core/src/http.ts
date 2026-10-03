/** Strip anything that looks like an API key before text reaches a log, an error, or the screen. */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-…")
    .replace(/sk-(?:admin|proj|svcacct)?-?[A-Za-z0-9_-]{16,}/g, "sk-…")
    .replace(/(authorization|x-api-key)(["':=\s]+)(bearer\s+)?[^\s"',]+/gi, "$1$2$3…");
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(redactSecrets(message));
    this.name = "ProviderError";
  }
}

export interface RequestOptions {
  headers: Record<string, string>;
  /** Injectable for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Attempts for 429/5xx/network errors. Default 4. */
  attempts?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * GET a JSON endpoint with retries on rate limits (honoring Retry-After), server errors, and network
 * failures. Errors carry the HTTP status and never include the key.
 */
export async function requestJson<T>(url: string, opts: RequestOptions): Promise<T> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const attempts = opts.attempts ?? 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: opts.headers,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (err) {
      lastError = new ProviderError(`network error: ${(err as Error).message}`);
      if (attempt < attempts) await sleep(1000 * 2 ** (attempt - 1));
      continue;
    }
    if (res.ok) return (await res.json()) as T;

    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string };
      detail = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? detail);
    } catch {
      // not JSON
    }
    lastError = new ProviderError(
      `${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
      res.status,
    );
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === attempts) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1),
    );
  }
  throw lastError;
}
