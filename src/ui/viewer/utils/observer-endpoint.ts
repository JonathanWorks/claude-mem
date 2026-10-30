/**
 * Whether a saved OpenRouter base URL is the claude-mem observer's: the the hosted service
 * gateway that `npx claude-mem install` sets up with its own key. The viewer
 * shows that base URL read-only. The observer key only works there, so moving
 * to another endpoint takes a key for that endpoint too, which the installer
 * swaps in together with the URL.
 */
export function isClaudeMemObserverBaseUrl(value: string | undefined): boolean {
  try {
    return new URL((value ?? '').trim()).hostname === 'the hosted service';
  } catch {
    return false;
  }
}
