// src/middlewares/rateLimit.js
//
// Small in-memory rate limiters (single API instance). If the API is ever
// scaled to several instances, move these counters to a shared store.

const buckets = new Map(); // key → { count, resetAt, blockedUntil }

function sweep() {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt <= now && (!b.blockedUntil || b.blockedUntil <= now)) buckets.delete(key);
  }
}
setInterval(sweep, 60_000).unref();

function hit(key, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs, blockedUntil: 0 };
    buckets.set(key, b);
  }
  b.count++;
  return b;
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function tooMany(res, retryMs, message) {
  const seconds = Math.max(1, Math.ceil(retryMs / 1000));
  res.set("Retry-After", String(seconds));
  return res.status(429).json({
    error: message.replace("{minutes}", String(Math.ceil(seconds / 60))),
    retryAfterSeconds: seconds,
  });
}

/**
 * Brute-force protection for login.
 *   • per email+IP: LOGIN_MAX_ATTEMPTS failures → locked LOGIN_LOCK_MINUTES
 *   • per IP: 4× that many failures (stops spraying many emails)
 * Only FAILED attempts count; a successful login clears the email+IP bucket.
 * The login handler reports the outcome via req.loginAttempt.fail()/.succeed().
 */
export function loginLimiter({
  maxAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS) || 5,
  lockMinutes = Number(process.env.LOGIN_LOCK_MINUTES) || 15,
} = {}) {
  const windowMs = lockMinutes * 60_000;

  return (req, res, next) => {
    const ip = clientIp(req);
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200);
    const userKey = `login:u:${email}|${ip}`;
    const ipKey = `login:ip:${ip}`;
    const now = Date.now();

    for (const key of [userKey, ipKey]) {
      const b = buckets.get(key);
      if (b?.blockedUntil && b.blockedUntil > now) {
        return tooMany(res, b.blockedUntil - now, "Too many failed login attempts. Try again in {minutes} minute(s).");
      }
    }

    req.loginAttempt = {
      fail() {
        const u = hit(userKey, windowMs);
        if (u.count >= maxAttempts) u.blockedUntil = Date.now() + windowMs;
        const i = hit(ipKey, windowMs);
        if (i.count >= maxAttempts * 4) i.blockedUntil = Date.now() + windowMs;
      },
      succeed() {
        buckets.delete(userKey);
      },
    };
    next();
  };
}

/** Generic fixed-window limiter, e.g. for public endpoints. */
export function simpleLimiter({ name, max, windowMs, message = "Too many requests. Please slow down." }) {
  return (req, res, next) => {
    const b = hit(`${name}:${clientIp(req)}`, windowMs);
    if (b.count > max) return tooMany(res, b.resetAt - Date.now(), message);
    next();
  };
}

/** For tests. */
export function __resetRateLimits() {
  buckets.clear();
}
