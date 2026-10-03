/**
 * The subset of Claude Code's status line stdin JSON that BurnRate reads.
 * Every field is optional: older versions omit some, and `rate_limits` only appears for
 * claude.ai Pro/Max subscribers (or behind a gateway with a spend limit) after the first response.
 * Schema reference: https://code.claude.com/docs/en/statusline
 */
export interface StatuslineInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  version?: string;
  model?: { id?: string; display_name?: string };
  workspace?: { current_dir?: string; project_dir?: string };
  cost?: {
    total_cost_usd?: number;
    total_duration_ms?: number;
    total_api_duration_ms?: number;
    total_lines_added?: number;
    total_lines_removed?: number;
  };
  context_window?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    context_window_size?: number;
    used_percentage?: number | null;
    remaining_percentage?: number | null;
  };
  fast_mode?: boolean;
  prompt_cache?: { warm?: boolean; hit_ratio?: number };
  rate_limits?: {
    five_hour?: RateWindow;
    seven_day?: RateWindow;
    spend_limit?: RateWindow & { used_usd?: number; limit_usd?: number; period?: string };
  };
}

export interface RateWindow {
  /** 0-100 (spend_limit can exceed 100). */
  used_percentage?: number;
  /** Unix epoch seconds. */
  resets_at?: number;
}

/** Parse stdin text. Returns an empty object for empty or invalid input rather than throwing. */
export function parseStatuslineInput(text: string): StatuslineInput {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as StatuslineInput) : {};
  } catch {
    return {};
  }
}
