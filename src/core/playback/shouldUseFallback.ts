/**
 * Decides whether a yt-dlp run failed in a way that should trigger the
 * external-API fallback. Anti-bot prompts, age/region restrictions, and
 * extraction errors all funnel here.
 */

const FALLBACK_TRIGGER_PATTERNS = [
  /Sign in to confirm you'?re not a bot/i,
  /Sign in to confirm your age/i,
  /confirm you'?re not a bot/i,
  /Video unavailable/i,
  /This video is not available/i,
  /not available in your country/i,
  /This video is private/i,
  /Private video/i,
  /age[- ]restricted/i,
  /age[- ]gated/i,
  /Premium members/i,
  /requires payment/i,
  /removed for violating/i,
  /unable to extract/i,
  /Unable to download webpage/i,
  /HTTP Error 403/i,
  /HTTP Error 429/i,
  /ERROR:/,
];

export interface YtdlpOutcome {
  exitCode: number | null;
  stderr: string;
  bytesStreamed: number;
}

/**
 * Returns `true` when yt-dlp's output indicates the bot should switch to the
 * fallback API. Triggers when:
 *   - exit code is non-zero AND nothing meaningful was streamed, OR
 *   - stderr matches one of the known YouTube anti-bot / unavailability strings.
 */
export function shouldUseFallback({ exitCode, stderr, bytesStreamed }: YtdlpOutcome): boolean {
  // Hard failure with no audio actually delivered → fallback.
  if ((exitCode ?? 0) !== 0 && bytesStreamed < 1024) {
    if (FALLBACK_TRIGGER_PATTERNS.some((re) => re.test(stderr))) return true;
    return true;
  }

  // Anti-bot / unavailability messages even with a non-fatal exit → fallback,
  // but only if we never got a real audio stream going.
  if (bytesStreamed < 1024 && FALLBACK_TRIGGER_PATTERNS.some((re) => re.test(stderr))) {
    return true;
  }

  return false;
}

export const FALLBACK_PATTERNS_FOR_TESTS = FALLBACK_TRIGGER_PATTERNS;
