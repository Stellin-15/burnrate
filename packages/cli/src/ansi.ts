export type Color = "green" | "yellow" | "red" | "dim" | "bold" | "cyan" | "magenta";

const CODES: Record<Color, [number, number]> = {
  green: [32, 39],
  yellow: [33, 39],
  red: [31, 39],
  cyan: [36, 39],
  magenta: [35, 39],
  dim: [2, 22],
  bold: [1, 22],
};

export type Paint = (color: Color, s: string) => string;

export const paintAnsi: Paint = (color, s) => `\x1b[${CODES[color][0]}m${s}\x1b[${CODES[color][1]}m`;
export const paintNone: Paint = (_color, s) => s;

/** Respect NO_COLOR (https://no-color.org) and FORCE_COLOR. */
export function colorEnabled(env = process.env, isTTY = process.stdout.isTTY): boolean {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  return !!isTTY;
}
