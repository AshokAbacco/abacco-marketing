// src/pages/campaigns/campaignPages/dailyLimitStore.js
import { useEffect, useState } from "react";
import { startVisiblePolling } from "../../utils/polling";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const POLL_MS = 15_000;

// ─────────────────────────────────────────────────────────────
// Shared store
//
// The banner, CreateCampaign and CampaignDetail each used this hook, and
// each ran its own 5-second poll — 3 requests every 5 s per open tab.
// Now all subscribers share ONE poller (15 s, paused in background tabs).
// ─────────────────────────────────────────────────────────────
const store = {
  data: null,
  listeners: new Set(),
  stopPolling: null,
};

async function fetchDailyLimit() {
  try {
    const res = await fetch(API_BASE_URL + "/api/campaigns/daily-limit", {
      headers: { Authorization: "Bearer " + localStorage.getItem("token") },
    });
    if (!res.ok) return;
    const result = await res.json();
    if (result.success) {
      store.data = result.data;
      store.listeners.forEach((fn) => fn(store.data));
    }
  } catch (err) {
    console.error("Daily limit error:", err);
  }
}

function subscribe(listener) {
  store.listeners.add(listener);
  if (store.listeners.size === 1) {
    store.stopPolling = startVisiblePolling(fetchDailyLimit, POLL_MS, { immediate: true });
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
export function refreshDailyLimit() {
  return fetchDailyLimit();
}

// ─────────────────────────────────────────────────────────────
// Shared hook
// ─────────────────────────────────────────────────────────────
export function useDailyLimit() {
  const [limitData, setLimitData] = useState(store.data);

  useEffect(() => subscribe(setLimitData), []);

  return limitData;
}

