// src/pages/campaigns/campaignPages/mailboxLimitsStore.js
//
// Per-mailbox daily limits from GET /api/campaigns/mailbox-limits:
//   limit (by provider) · sent today · remaining · pending
// One shared poller for every component that uses it (same pattern as
// dailyLimitStore.js), paused in background tabs.
import { useEffect, useState } from "react";
import { startVisiblePolling } from "../../utils/polling";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const POLL_MS = 20_000;

const EMPTY = Object.freeze({
  loaded: false,
  accounts: [],
  byId: {},
  resetsAt: null,
  providerLimits: {},
});

const store = { data: EMPTY, listeners: new Set(), stopPolling: null };

async function fetchMailboxLimits() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/campaigns/mailbox-limits`, {
      headers: { Authorization: "Bearer " + localStorage.getItem("token") },
    });
    if (!res.ok) return;
    const result = await res.json();
    if (!result.success) return;
    const accounts = result.data.accounts || [];
    store.data = {
      loaded: true,
      accounts,
      byId: Object.fromEntries(accounts.map((a) => [a.id, a])),
      resetsAt: result.data.resetsAt ? new Date(result.data.resetsAt) : null,
      providerLimits: result.data.providerLimits || {},
    };
    store.listeners.forEach((fn) => fn(store.data));
  } catch (err) {
    console.error("Mailbox limits error:", err);
  }
}

function subscribe(listener) {
  store.listeners.add(listener);
  if (store.listeners.size === 1) {
    store.stopPolling = startVisiblePolling(fetchMailboxLimits, POLL_MS, {
      immediate: true,
    });
  }
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0 && store.stopPolling) {
      store.stopPolling();
      store.stopPolling = null;
    }
  };
}

/** Force a refresh now (e.g. right after starting a campaign). */
export function refreshMailboxLimits() {
  return fetchMailboxLimits();
}

export function useMailboxLimits() {
  const [data, setData] = useState(store.data);
  useEffect(() => subscribe(setData), []);
  return data;
}

/** "Gmail: 245 / 300 sent" (or "Custom: 245 sent · no daily limit"). */
export function formatLimitLine(m) {
  if (!m) return "";
  const sent = (m.sentToday || 0).toLocaleString();
  return m.dailyLimit != null
    ? `${m.providerLabel}: ${sent} / ${m.dailyLimit.toLocaleString()} sent`
    : `${m.providerLabel}: ${sent} sent (no daily limit)`;
}