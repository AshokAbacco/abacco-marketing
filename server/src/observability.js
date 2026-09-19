// src/observability.js
//
// Optional error monitoring (Phase 4).
//
// Set SENTRY_DSN to send crashes and handled errors to Sentry; leave it
// unset and everything here is a no-op, so nothing breaks without it.
// Sign-up is free for small volumes: https://sentry.io
//
// Nothing sensitive is sent: request bodies, headers and cookies are
// dropped, and anything that looks like a password or token is masked.

let sentry = null;
let enabled = false;

const SENSITIVE_RE = /(pass(word)?|token|secret|authorization|api[_-]?key|encryptedPass|dsn)/i;

/** Remove credentials from anything we attach to an event. */
export function scrub(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_RE.test(k) ? "[redacted]" : scrub(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

/**
 * Start error monitoring for this process.
 * @param {"api"|"worker"|"script"} role
 */
export async function initObservability(role = process.env.PROCESS_ROLE || "api") {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || enabled) return enabled;
  try {
    sentry = await import("@sentry/node");
    sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      release: process.env.RELEASE_VERSION || undefined,
      sampleRate: Number(process.env.SENTRY_SAMPLE_RATE) || 1,
      tracesSampleRate: 0,          // errors only — no performance data, no extra cost
      sendDefaultPii: false,
      initialScope: { tags: { role } },
      beforeSend(event) {
        delete event.request?.data;
        delete event.request?.cookies;
        delete event.request?.headers;
        if (event.extra) event.extra = scrub(event.extra);
        return event;
      },
    });
    enabled = true;
    console.log(`🛰️  Error monitoring on (Sentry, role=${role})`);
  } catch (err) {
    console.warn(`⚠️  Could not start error monitoring: ${err.message}`);
  }
  return enabled;
}

/** Report an error. Safe to call when monitoring is off. */
export function captureError(error, context = {}) {
  if (!enabled || !sentry) return;
  try {
    sentry.withScope((scope) => {
      const { tags, user, ...extra } = context;
      if (tags) scope.setTags(tags);
      if (user?.id) scope.setUser({ id: user.id });
      if (Object.keys(extra).length) scope.setExtras(scrub(extra));
      sentry.captureException(error instanceof Error ? error : new Error(String(error)));
    });
  } catch { /* monitoring must never break the app */ }
}

/** Flush pending events before the process exits. */
export async function flushObservability(timeoutMs = 2000) {
  if (!enabled || !sentry) return;
  try {
    await sentry.flush(timeoutMs);
  } catch { /* ignore */ }
}

export const observabilityEnabled = () => enabled;
