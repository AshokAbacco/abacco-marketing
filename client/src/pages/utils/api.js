// api.js
import axios from "axios";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// 🔐 Attach JWT token to every request
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/* ═══════════════════════════════════════════════════════════════════════════
   WHY THIS CHANGED

   The old interceptor logged the user out on ANY 401. Combined with the old
   authMiddleware — which returned 401 for database errors as well as token
   errors — a saturated connection pool logged everyone out mid-session.

   Two layers of defence now:
     1. The server returns 503 (not 401) for infrastructure problems.
     2. This only clears the session when the server explicitly says the
        TOKEN is bad, and never on a network error with no response.
═══════════════════════════════════════════════════════════════════════════ */

// Errors that genuinely mean "this session is over".
const AUTH_FAILURE_MESSAGES = [
  "token expired",
  "invalid token",
  "not authorized",
  "user not found",
  "account is inactive",   // admin deactivated this user — end the session
  "inactive",
];

function isRealAuthFailure(error) {
  const res = error.response;

  // No response at all → network blip, server restart, CORS. NOT an auth
  // failure. Logging out here is what made a hiccup look like a logout.
  if (!res) return false;

  if (res.status !== 401) return false;

  const body = res.data || {};
  const msg = String(body.error || body.message || "").toLowerCase();

  // An explicitly retryable response is never an auth failure.
  if (body.retryable) return false;

  // Unrecognised 401s are treated as auth failures (safe default), but a
  // known infrastructure message is not.
  if (!msg) return true;
  return AUTH_FAILURE_MESSAGES.some((m) => msg.includes(m));
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/";
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    if (status === 503) {
      console.warn("Server busy (503) — staying logged in, safe to retry.");
      return Promise.reject(error);
    }

    if (!error.response) {
      console.warn("Network error — staying logged in.", error.message);
      return Promise.reject(error);
    }

    console.error("API Error:", error.response?.data || error.message);

    if (isRealAuthFailure(error)) {
      logout();
    }

    return Promise.reject(error);
  }
);