import { useEffect, useState, useCallback } from "react";
import { Mail, Clock, Zap, AlertTriangle } from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// ─────────────────────────────────────────────────────────────
// Shared hook
// ─────────────────────────────────────────────────────────────
export function useDailyLimit() {
  const [limitData, setLimitData] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(API_BASE_URL + "/api/campaigns/daily-limit", {
        headers: { Authorization: "Bearer " + localStorage.getItem("token") },
      });
      const result = await res.json();
      if (result.success) setLimitData(result.data);
    } catch (err) {
      console.error("Daily limit error:", err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return limitData;
}

// ─────────────────────────────────────────────────────────────
// Helper: Convert IST window → user local time
// ─────────────────────────────────────────────────────────────
function getLocalWindow() {
  const now = new Date();

  // Create IST times
  const istStart = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
  istStart.setHours(17, 0, 0, 0);

  const istEnd = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
  istEnd.setHours(5, 0, 0, 0);

  // Convert to user local
  const localStart = new Date(istStart.toLocaleString());
  const localEnd = new Date(istEnd.toLocaleString());

  const format = (date) =>
    date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

  return {
    start: format(localStart),
    end: format(localEnd),
  };
}

// ─────────────────────────────────────────────────────────────
// Banner component
// ─────────────────────────────────────────────────────────────
export default function DailyLimitBanner() {
  const data = useDailyLimit();

  if (!data) return null;

  const pct = Math.min((data.dailySent / data.dailyLimit) * 100, 100);
  const isNearLimit = data.remaining <= 500;
  const isExhausted = data.remaining <= 0;

  const localWindow = getLocalWindow();

  const barColor = isExhausted
    ? "bg-red-500"
    : isNearLimit
    ? "bg-amber-400"
    : "bg-sky-500";

  const containerBg = isExhausted
    ? "bg-red-50 border-red-200"
    : isNearLimit
    ? "bg-amber-50 border-amber-200"
    : "bg-gradient-to-r from-sky-50 to-blue-50 border-sky-200";

  const textColor = isExhausted
    ? "text-red-700"
    : isNearLimit
    ? "text-amber-800"
    : "text-sky-800";

  const subTextColor = isExhausted
    ? "text-red-500"
    : isNearLimit
    ? "text-amber-600"
    : "text-sky-600";

  return (
    <div
      className={`rounded-2xl border px-5 py-1 shadow-sm w-full max-w-sm ${containerBg}`}
    >
      {/* Top row */}
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className={`flex items-center gap-2 font-bold text-sm ${textColor}`}>
          {isExhausted ? (
            <AlertTriangle size={15} className="text-red-500" />
          ) : (
            <Mail size={15} />
          )}
          Daily Email Quota
        </div>

        <span
          className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
            data.withinWindow
              ? "bg-sky-100 text-sky-700 border-sky-200"
              : "bg-slate-100 text-slate-500 border-slate-200"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full inline-block ${
              data.withinWindow ? "bg-sky-500 animate-pulse" : "bg-slate-400"
            }`}
          />
          {data.withinWindow ? "Window Open" : "Window Closed"}
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Counts */}
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold ${subTextColor}`}>
          <span className="font-black">{data.dailySent.toLocaleString()}</span>
          {" / "}
          {data.dailyLimit.toLocaleString()} sent
        </span>
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
            isExhausted
              ? "bg-red-100 text-red-700"
              : isNearLimit
              ? "bg-amber-100 text-amber-700"
              : "bg-sky-100 text-sky-700"
          }`}
        >
          <Zap size={11} className="inline mr-0.5 -mt-px" />
          {data.remaining.toLocaleString()} left
        </span>
      </div>

      {/* Time info */}
      <div className={`text-[10px] mt-1 font-medium ${subTextColor}`}>
        <p>
          <Clock size={10} className="inline mr-1 -mt-px" />
          IST: 5 PM – 5 AM
        </p>
        <p>
          Your Time: {localWindow.start} – {localWindow.end}
        </p>
      </div>
    </div>
  );
}