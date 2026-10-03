// Builds a fake Claude Code home with ~45 days of synthetic, deterministic usage.
// Used by the end-to-end tests and for screenshots. Contains no real data.
//   node apps/dashboard/e2e/seed.mjs <targetDir> [--now 2026-10-03T15:00:00]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("usage: node seed.mjs <targetDir> [--now ISO]");
  process.exit(2);
}
const nowArg = process.argv.indexOf("--now");
const now = nowArg > 0 ? new Date(process.argv[nowArg + 1]) : new Date();

// Small deterministic PRNG so every run produces identical data.
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (weights) => {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of weights) if ((r -= w) <= 0) return v;
  return weights[0][0];
};

const projects = [
  ["/home/dev/acme-api", 5],
  ["/home/dev/web-app", 3],
  ["/home/dev/infra", 1.5],
  ["/home/dev/docs-site", 0.7],
];
const modelsEarly = [
  ["claude-opus-4-7", 3],
  ["claude-sonnet-4-6", 4],
  ["claude-haiku-4-5-20251001", 2],
];
const modelsLate = [
  ["claude-opus-5-5", 4],
  ["claude-sonnet-5-5", 4],
  ["claude-haiku-4-5-20251001", 2],
];

const lines = new Map(); // file -> lines[]
let msg = 0;
for (let daysAgo = 44; daysAgo >= 0; daysAgo--) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  if (weekend && rand() < 0.6) continue;
  const sessions = 1 + Math.floor(rand() * (weekend ? 2 : 5));
  for (let s = 0; s < sessions; s++) {
    const project = pick(projects);
    const sessionId = `seed-${daysAgo}-${s}-${Math.floor(rand() * 1e6).toString(16)}`;
    const startHour = 8 + Math.floor(rand() * 10);
    const requests = 10 + Math.floor(rand() * 70);
    const file = join(target, "projects", project.replace(/\//g, "-"), `${sessionId}.jsonl`);
    const out = lines.get(file) ?? [];
    let context = 8000;
    for (let r = 0; r < requests; r++) {
      const ts = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        startHour,
        r * 2,
        Math.floor(rand() * 60),
      );
      if (ts > now) break;
      const model = pick(daysAgo > 18 ? modelsEarly : modelsLate);
      const output = Math.floor(200 + rand() * 1800);
      const write = r === 0 ? context : Math.floor(rand() * 4000);
      const usage = {
        input_tokens: Math.floor(5 + rand() * 400),
        cache_read_input_tokens: context,
        cache_creation_input_tokens: write,
        cache_creation: { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: 0 },
        output_tokens: output,
      };
      context = Math.min(context + output + write, 180000);
      out.push(
        JSON.stringify({
          type: "assistant",
          timestamp: ts.toISOString(),
          sessionId,
          cwd: project,
          requestId: `req_seed_${msg}`,
          message: { id: `msg_seed_${msg++}`, model, usage },
        }),
      );
    }
    lines.set(file, out);
  }
}

for (const [file, content] of lines) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content.join("\n") + "\n");
}
console.log(`seeded ${msg} requests in ${lines.size} sessions under ${target}`);
