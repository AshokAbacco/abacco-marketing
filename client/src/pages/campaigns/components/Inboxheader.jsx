import React, { useState, useRef } from "react";
import { Mail, Search, RefreshCcw, Clock } from "lucide-react";

// Emails are kept for this many days after they arrive (server-side
// retention, see server/src/config/emailRetention.js). Keep in sync with
// EMAIL_RETENTION_DAYS on the server.
const RETENTION_DAYS = 7;

export default function InboxHeader({
  selectedAccount,
  selectedFolder,
  onSearchEmail,
  onRefresh,
}) {
  const [searchEmail, setSearchEmail]     = useState("");
  const [isRefreshing, setIsRefreshing]   = useState(false);

  const searchTimeoutRef = useRef(null);

  // ── Search with debounce ─────────────────────────────────
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchEmail(value);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      if (onSearchEmail) onSearchEmail(value);
    }, 500);
  };

  // ── Refresh with spin animation ──────────────────────────
  const handleRefresh = () => {
    setIsRefreshing(true);
    onRefresh();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  return (
    <div className="bg-white/80 backdrop-blur-xl border-b border-sky-200/50 px-6 py-3 shadow-sm">
      {/* ── Top row ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">

        {/* Left – title + account email */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-sky-500 to-blue-600 rounded-xl blur opacity-50" />
            <div className="relative w-10 h-10 bg-gradient-to-br from-sky-600 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/30">
              <Mail className="text-white" size={18} />
            </div>
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-sky-600 to-blue-600 bg-clip-text text-transparent">
              {selectedFolder
                ? selectedFolder.charAt(0).toUpperCase() + selectedFolder.slice(1)
                : "Inbox"}
            </h1>
            {selectedAccount && (
              <p className="text-xs text-slate-600 font-medium">
                {selectedAccount.email}
              </p>
            )}
          </div>
        </div>

        {/* Right – retention note + refresh */}
        <div className="flex items-center gap-2">

          {/* Replaces the month filter: only the last 7 days are stored, so
              "Last month" / "Last 3 months" would always be empty. */}
          <span
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-sky-200 rounded-lg bg-white text-slate-600 font-medium"
            title={`Emails are removed automatically ${RETENTION_DAYS} days after they arrive`}
          >
            <Clock size={15} className="text-sky-500 flex-shrink-0" />
            Last {RETENTION_DAYS} days
          </span>

          {/* ── Refresh button ── */}
          <button
            onClick={handleRefresh}
            className="bg-blue-200 flex items-center gap-2 px-3 py-1.5 text-sm border border-blue-300 rounded-lg hover:bg-blue-300 transition-colors"
            aria-label="Refresh inbox"
          >
            <RefreshCcw
              size={16}
              className={`transition-transform duration-700 ${
                isRefreshing ? "rotate-[360deg]" : ""
              }`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Search bar ──────────────────────────────────────── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sky-400" />
        <input
          type="text"
          placeholder="Search by email ID..."
          value={searchEmail}
          onChange={handleSearchChange}
          className="
            w-full pl-10 pr-4 py-2
            border border-sky-200 rounded-lg text-sm
            focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent
            bg-white/80 backdrop-blur-sm placeholder-slate-400
          "
        />
      </div>
    </div>
  );
}