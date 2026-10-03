import { ProviderError, type ProviderId } from "@burnrate/core";
import { looksLikeAdminKey as anthropicLooksAdmin } from "@burnrate/adapter-anthropic-api";
import { looksLikeAdminKey as openaiLooksAdmin } from "@burnrate/adapter-openai-api";
import { openStoreQuietly } from "@burnrate/store";
import {
  PROVIDERS,
  isProvider,
  maskKey,
  osKeychain,
  readSecret,
  resolveKey,
  type Keychain,
} from "../keys.js";
import { syncProvider } from "../sync.js";

const LOOKS_ADMIN: Record<ProviderId, (k: string) => boolean> = {
  anthropic: anthropicLooksAdmin,
  openai: openaiLooksAdmin,
};

export interface KeysArgs {
  action?: string;
  provider?: string;
  sync?: boolean;
  days?: number;
}

const USAGE = "Usage: burnrate keys add|remove|test <anthropic|openai>   or   burnrate keys list";

/** Explain auth failures in terms of what to do next. */
export function explainProviderError(provider: ProviderId, err: unknown): string {
  const p = PROVIDERS[provider];
  if (err instanceof ProviderError && (err.status === 401 || err.status === 403))
    return `${p.label} rejected the key (${err.status}). Usage and cost data needs an organization Admin key (${p.example}), not a regular API key. Create one at ${p.console}.`;
  if (err instanceof ProviderError && err.status === 429)
    return `${p.label} is rate limiting requests. Try again in a minute.`;
  return `${p.label}: ${(err as Error).message}`;
}

export async function runKeys(args: KeysArgs): Promise<number> {
  const keychainOrError = await osKeychain();
  const keychain: Keychain | undefined = "error" in keychainOrError ? undefined : keychainOrError;
  const keychainProblem = "error" in keychainOrError ? keychainOrError.error : undefined;

  if (args.action === "list" || !args.action) {
    for (const [id, p] of Object.entries(PROVIDERS) as Array<[ProviderId, (typeof PROVIDERS)[ProviderId]]>) {
      const k = resolveKey(id, keychain);
      console.log(
        `${p.label.padEnd(10)} ${k ? `${maskKey(k.key)}  (${k.source === "env" ? `from ${p.env}` : "OS keychain"})` : "no key"}`,
      );
    }
    const { store } = openStoreQuietly();
    if (store) {
      for (const s of store.syncState())
        console.log(
          `  ${PROVIDERS[s.provider as ProviderId]?.label ?? s.provider} last synced ${new Date(s.lastSyncedAt).toLocaleString()}${s.lastError ? ` (failed: ${s.lastError})` : ""}`,
        );
      store.close();
    }
    if (keychainProblem)
      console.log(`\nNote: ${keychainProblem}. Set keys with environment variables instead.`);
    return 0;
  }

  if (!isProvider(args.provider)) {
    console.error(USAGE);
    return 2;
  }
  const provider = args.provider;
  const p = PROVIDERS[provider];

  switch (args.action) {
    case "add": {
      if (!keychain) {
        console.error(`Can't store keys: ${keychainProblem}. Set ${p.env} in your environment instead.`);
        return 1;
      }
      console.error(
        `Paste your ${p.label} Admin key (${p.example}). It's stored in your OS keychain, never in a file.`,
      );
      const key = await readSecret("Key (hidden): ").catch(() => "");
      if (!key) {
        console.error("No key entered. Nothing was saved.");
        return 1;
      }
      if (!LOOKS_ADMIN[provider](key))
        console.error(
          `Warning: this doesn't look like an Admin key (${p.example}). Regular API keys can't read usage.`,
        );

      const { store, problem } = openStoreQuietly();
      if (!store) {
        console.error(`Can't sync: ${problem}.`);
        return 1;
      }
      try {
        // Verify by doing the first sync before saving, so a wrong key never gets stored.
        console.error(`Contacting ${p.label} to check the key and load the last ${args.days ?? 30} days…`);
        const r = await syncProvider(provider, key, store, {
          days: args.sync === false ? 1 : (args.days ?? 30),
        });
        keychain.set(provider, key);
        console.log(`✓ Saved your ${p.label} key (${maskKey(key)}) to the OS keychain.`);
        console.log(
          `  Loaded ${r.usageRows} usage rows and ${r.costRows} cost lines: $${r.reportedUsd.toFixed(2)} billed since ${r.from.toISOString().slice(0, 10)}.`,
        );
        console.log("  See it with `burnrate spend` or in `burnrate dashboard`.");
        return 0;
      } catch (err) {
        console.error(explainProviderError(provider, err));
        console.error("The key was not saved.");
        return 1;
      } finally {
        store.close();
      }
    }
    case "remove": {
      if (!keychain) {
        console.error(`Can't reach the keychain: ${keychainProblem}.`);
        return 1;
      }
      const removed = keychain.delete(provider);
      console.log(
        removed ? `✓ Removed your ${p.label} key from the OS keychain.` : `No ${p.label} key was stored.`,
      );
      if (process.env[p.env]) console.log(`Note: ${p.env} is still set in your environment.`);
      return 0;
    }
    case "test": {
      const k = resolveKey(provider, keychain);
      if (!k) {
        console.error(`No ${p.label} key. Add one with \`burnrate keys add ${provider}\` or set ${p.env}.`);
        return 1;
      }
      const { store, problem } = openStoreQuietly();
      if (!store) {
        console.error(`Can't sync: ${problem}.`);
        return 1;
      }
      try {
        const r = await syncProvider(provider, k.key, store, { days: 1 });
        console.log(
          `✓ ${p.label} key works (${maskKey(k.key)}). Today so far: $${r.reportedUsd.toFixed(2)} billed.`,
        );
        return 0;
      } catch (err) {
        console.error(explainProviderError(provider, err));
        return 1;
      } finally {
        store.close();
      }
    }
    default:
      console.error(USAGE);
      return 2;
  }
}
