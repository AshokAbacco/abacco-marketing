// src/pages/utils/polling.js
//
// Visibility-aware polling. Background tabs used to keep hitting the API
// every few seconds for hours; now polling pauses while the tab is hidden
// and refreshes once as soon as the user comes back.

/**
 * Call `fn` every `intervalMs` while the page is visible.
 * Returns a cleanup function — call it from a useEffect cleanup.
 *
 * Ticks never overlap: if `fn` is still running (slow network), the next
 * tick is skipped instead of stacking requests.
 *
 * @param {() => (void|Promise<void>)} fn
 * @param {number} intervalMs
 * @param {{ immediate?: boolean }} [opts] immediate: also run right away
 */
export function startVisiblePolling(fn, intervalMs, { immediate = false } = {}) {
  let timer = null;
  let inFlight = false;
  let stopped = false;

  const run = async () => {
    if (stopped || inFlight || document.hidden) return;
    inFlight = true;
    try {
      await fn();
    } catch {
      /* callers handle their own errors */
    } finally {
      inFlight = false;
    }
  };

  const start = () => {
    if (!timer) timer = setInterval(run, intervalMs);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const onVisibility = () => {
    if (document.hidden) {
      stop();
    } else {
      run();
      start();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  if (immediate) run();
  if (!document.hidden) start();

  return () => {
    stopped = true;
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
