// src/pages/crm/lib.js — shared helpers and hooks for the CRM pages.
import { useCallback, useEffect, useState } from "react";
import { api } from "../utils/api";

export const LIFECYCLES = [
  { value: "lead", label: "Lead" },
  { value: "prospect", label: "Prospect" },
  { value: "customer", label: "Customer" },
  { value: "lost", label: "Lost" },
];

export const CATEGORIES = [
  { value: "association", label: "Association" },
  { value: "attendees", label: "Attendees" },
  { value: "industry", label: "Industry" },
];

export const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
];

export const REPLY_CATEGORIES = [
  {
    value: "interested",
    label: "Interested",
    style: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  {
    value: "meeting",
    label: "Wants a meeting",
    style: "bg-teal-50 text-teal-700 border-teal-200",
  },
  {
    value: "question",
    label: "Question",
    style: "bg-sky-50 text-sky-700 border-sky-200",
  },
  {
    value: "not_interested",
    label: "Not interested",
    style: "bg-slate-100 text-slate-700 border-slate-200",
  },
  {
    value: "wrong_person",
    label: "Wrong person",
    style: "bg-amber-50 text-amber-700 border-amber-200",
  },
  {
    value: "unsubscribe",
    label: "Unsubscribe",
    style: "bg-red-50 text-red-700 border-red-200",
  },
  {
    value: "other",
    label: "Other",
    style: "bg-violet-50 text-violet-700 border-violet-200",
  },
];

export const CURRENCIES = [
  "USD",
  "INR",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "AED",
  "SGD",
];

export function errMessage(err, fallback = "Something went wrong") {
  return (
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    fallback
  );
}

export function formatMoney(amount, currency = "USD") {
  if (amount === null || amount === undefined || amount === "") return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toLocaleString()}`;
  }
}

export function formatDate(value, withTime = false) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function timeAgo(value) {
  if (!value) return "never";
  const diff = Date.now() - new Date(value).getTime();
  const abs = Math.abs(diff);
  const units = [
    ["year", 31536e6],
    ["month", 2592e6],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(-Math.round(diff / ms), unit);
  }
  return "just now";
}

/** <input type="datetime-local"> value for a Date/ISO string (local time). */
export function toLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local datetime-local value → ISO string (or null). */
export function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

export function isAdminOrHr() {
  const role = String(currentUser()?.jobRole || "").toLowerCase();
  return role === "admin" || role === "hr";
}

/**
 * GET with loading/error state. Re-fetches when path or params change and
 * when reload() is called. Previous data stays visible while reloading.
 */
export function useApiGet(path, params) {
  const key = path ? `${path}?${JSON.stringify(params || {})}` : null;
  const [nonce, setNonce] = useState(0);
  const reqKey = key ? `${key}#${nonce}` : null;
  const [state, setState] = useState({ reqKey: null, data: null, error: null });

  useEffect(() => {
    if (!reqKey) return undefined;
    let cancelled = false;
    api
      .get(path, { params })
      .then((r) => {
        if (!cancelled) setState({ reqKey, data: r.data, error: null });
      })
      .catch((err) => {
        if (!cancelled)
          setState((s) => ({
            reqKey,
            data: s.data,
            error: errMessage(err, "Could not load data"),
          }));
      });
    return () => {
      cancelled = true;
    };
    // `key` already encodes path + params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {
    data: state.data,
    error: state.error,
    loading: Boolean(reqKey) && state.reqKey !== reqKey,
    reload,
  };
}

/* Users for owner / assignee pickers — fetched once per page load. */
let usersPromise = null;
export function loadCrmUsers() {
  if (!usersPromise) {
    usersPromise = api
      .get("/api/crm/users")
      .then((r) => r.data.data || [])
      .catch((err) => {
        usersPromise = null;
        throw err;
      });
  }
  return usersPromise;
}

export function useCrmUsers() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    loadCrmUsers()
      .then((u) => {
        if (!cancelled) setUsers(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return users;
}

/** Debounced copy of a value. */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
