/**
 * Pure FFmpeg-argument helpers extracted from StreamingDelegate so the
 * quote-aware tokenizer and URL host extraction can be unit-tested in isolation.
 */

/**
 * Splits a shell-style FFmpeg command string into argv tokens, honouring
 * single- and double-quoted groups (quotes are stripped from the token).
 */
export function tokenizeFfmpegArgs(command: string): string[] {
  const args: string[] = [];
  const re = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    args.push(match[1] ?? match[2] ?? match[0]);
  }
  return args;
}

/** Returns the host[:port] of a URL, or null when it cannot be parsed. */
export function extractHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
