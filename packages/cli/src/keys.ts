import type { ProviderId } from "@burnrate/core";

export const PROVIDERS: Record<ProviderId, { label: string; env: string; example: string; console: string }> =
  {
    anthropic: {
      label: "Anthropic",
      env: "ANTHROPIC_ADMIN_KEY",
      example: "sk-ant-admin01-…",
      console: "https://platform.claude.com/settings/admin-keys",
    },
    openai: {
      label: "OpenAI",
      env: "OPENAI_ADMIN_KEY",
      example: "sk-admin-…",
      console: "https://platform.openai.com/settings/organization/admin-keys",
    },
  };

export const isProvider = (v: unknown): v is ProviderId => typeof v === "string" && v in PROVIDERS;

const SERVICE = "burnrate";

/** Minimal keychain surface, so tests can swap in a fake. */
export interface Keychain {
  get(provider: ProviderId): string | undefined;
  set(provider: ProviderId, key: string): void;
  delete(provider: ProviderId): boolean;
}

/**
 * The OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) via @napi-rs/keyring.
 * Loaded lazily and optionally: if it can't load on this platform, keys must come from environment variables.
 */
export async function osKeychain(): Promise<Keychain | { error: string }> {
  let mod: typeof import("@napi-rs/keyring");
  try {
    mod = await import("@napi-rs/keyring");
  } catch (err) {
    return { error: `the OS keychain isn't available here (${(err as Error).message.split("\n")[0]})` };
  }
  const entry = (p: ProviderId) => new mod.Entry(SERVICE, `${p}-admin-key`);
  return {
    get: (p) => entry(p).getPassword() ?? undefined,
    set: (p, key) => entry(p).setPassword(key),
    delete: (p) => entry(p).deletePassword(),
  };
}

export interface ResolvedKey {
  key: string;
  source: "env" | "keychain";
}

/** Environment variable first (handy for CI and scripts), then the keychain. */
export function resolveKey(
  provider: ProviderId,
  keychain: Keychain | undefined,
  env = process.env,
): ResolvedKey | undefined {
  const fromEnv = env[PROVIDERS[provider].env]?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  try {
    const stored = keychain?.get(provider);
    if (stored) return { key: stored, source: "keychain" };
  } catch {
    // locked or unavailable keychain: treat as no key
  }
  return undefined;
}

/** "sk-ant-admin01-abcd…wxyz" style: enough to recognize, useless to steal. */
export function maskKey(key: string): string {
  if (key.length <= 12) return "…";
  return `${key.slice(0, key.indexOf("-", 3) + 1 || 6)}…${key.slice(-4)}`;
}

/** Read a line from the terminal without echoing it, or the whole of stdin when piped. */
export async function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
      if (err) reject(err);
      else resolve(value.trim());
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "\u0003") return done(new Error("cancelled"));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
