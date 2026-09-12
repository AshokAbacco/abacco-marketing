// AdminDailyOverview.jsx
// Place in: src/pages/AdminDailyOverview.jsx
// Access: admin / hr roles only — guard this route in your router

import { useEffect, useState, useCallback } from "react";
import {
  Mail, RefreshCw, Zap, Users, TrendingUp,
  Clock, CheckCircle2, AlertTriangle, Loader2, Radio,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { api } from "../utils/api"; // adjust path

const POLL_INTERVAL = 15_000;
const DAILY_LIMIT   = 5_000;
const PAGE_SIZE     = 10;

// ─── Status badge config ──────────────────────────────────────────────────────
const STATUS_CONFIG = {
  sending: {
    label: "Sending",
    dot:   "bg-sky-500 animate-pulse",
    badge: "bg-sky-50 text-sky-700 border-sky-200",
    icon:  <Radio size={10} className="inline mr-0.5" />,
  },
  active: {
    label: "Active Today",
    dot:   "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    icon:  <TrendingUp size={10} className="inline mr-0.5" />,
  },
  completed: {
    label: "Limit Reached",
    dot:   "bg-red-500",
    badge: "bg-red-50 text-red-700 border-red-200",
    icon:  <AlertTriangle size={10} className="inline mr-0.5" />,
  },
  idle: {
    label: "Idle",
    dot:   "bg-slate-300",
    badge: "bg-slate-100 text-slate-500 border-slate-200",
    icon:  <Clock size={10} className="inline mr-0.5" />,
  },
};

// ─── Bar color ────────────────────────────────────────────────────────────────
function barColor(pct) {
  if (pct >= 100) return "bg-gradient-to-r from-red-500 to-rose-500";
  if (pct >= 75)  return "bg-gradient-to-r from-amber-400 to-orange-400";
  if (pct >= 40)  return "bg-gradient-to-r from-blue-500 to-sky-500";
  return "bg-gradient-to-r from-sky-500 to-blue-500";
}

// ─── Relative time helper ─────────────────────────────────────────────────────
function fromNow(date) {
  if (!date) return "—";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Summary Card ─────────────────────────────────────────────────────────────
function SummaryCard({ iconBg, icon, label, value, sub }) {
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-sky-100 p-5 flex items-center gap-4 hover:shadow-xl transition-shadow duration-200">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide truncate">{label}</p>
        <p className="text-2xl font-bold text-slate-800 leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function ProgressBar({ pct }) {
  const clamped = Math.min(pct, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-sky-50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor(pct)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-[11px] text-slate-400 w-8 text-right font-medium">{pct}%</span>
    </div>
  );
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────
const FILTER_TABS = [
  { key: "all",       label: "All"          },
  { key: "sending",   label: "Sending"      },
  { key: "active",    label: "Active"       },
  { key: "completed", label: "Limit Reached"},
  { key: "idle",      label: "Idle"         },
];

// ─── Pagination Controls ──────────────────────────────────────────────────────
function Pagination({ page, totalPages, onPrev, onNext, totalItems, pageSize }) {
  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-sky-100 bg-gradient-to-r from-sky-50/50 to-blue-50/50">
      <p className="text-xs text-slate-500">
        Showing <span className="font-semibold text-slate-700">{from}–{to}</span> of{" "}
        <span className="font-semibold text-slate-700">{totalItems}</span> users
      </p>
      <div className="flex items-center gap-1">
        {/* Page number pills */}
        <div className="flex items-center gap-1 mr-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => {
                if (p < page) onPrev(page - p);
                else if (p > page) onNext(p - page);
              }}
              className={`w-7 h-7 rounded-lg text-xs font-semibold transition-all duration-200 ${
                p === page
                  ? "bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-sm"
                  : "text-slate-500 hover:bg-sky-100 hover:text-sky-700"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          onClick={() => onPrev(1)}
          disabled={page === 1}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 border-sky-200 bg-white text-xs text-sky-700 font-semibold hover:bg-sky-50 hover:border-sky-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
        >
          <ChevronLeft size={14} />
          Prev
        </button>
        <button
          onClick={() => onNext(1)}
          disabled={page === totalPages || totalPages === 0}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 border-sky-200 bg-white text-xs text-sky-700 font-semibold hover:bg-sky-50 hover:border-sky-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
        >
          Next
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminDailyOverview() {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [search,      setSearch]      = useState("");
  const [filter,      setFilter]      = useState("all");
  const [error,       setError]       = useState(null);
  const [page,        setPage]        = useState(1);

  const fetchData = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setError(null);

    try {
      const res    = await api.get("/api/campaigns/admin/daily-overview");
      const result = res.data;

      if (result.success) {
        setData(result.data);
        setLastUpdated(new Date());
      } else {
        throw new Error(result.message || "Failed");
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
        err.message ||
        "Failed to load data"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    fetchData(true);
    const timer = setInterval(() => fetchData(false), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchData]);

  // Reset to page 1 when search or filter changes
  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  // ── Counts for filter tabs ────────────────────────────────────────────────
  const counts = (data?.users || []).reduce((acc, u) => {
    acc[u.status] = (acc[u.status] || 0) + 1;
    return acc;
  }, {});

  // ── Filter + search ───────────────────────────────────────────────────────
  const visible = (data?.users || []).filter((u) => {
    const matchSearch =
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.empId.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());

    const matchFilter =
      filter === "all"
        ? u.status !== "idle"
        : u.status === filter;

    return matchSearch && matchFilter;
  });

  // ── Pagination ────────────────────────────────────────────────────────────
  const totalPages  = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages);
  const paginated   = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const sendingNow     = data?.users?.filter(u => u.status === "sending").length || 0;
  const totalSentToday = data?.users?.reduce((s, u) => s + (u.dailySent || 0), 0) ?? 0;

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 bg-gradient-to-br from-sky-50 via-blue-50 to-blue-50">
        <Loader2 className="animate-spin text-sky-500" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-red-500 bg-gradient-to-br from-sky-50 via-blue-50 to-blue-50">
        <AlertTriangle size={32} />
        <p className="font-semibold text-sm">{error}</p>
        <button
          onClick={() => fetchData(true)}
          className="px-4 py-1.5 rounded-lg bg-red-50 border border-red-200 text-sm hover:bg-red-100 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-8xl mx-auto space-y-5 bg-gradient-to-br from-sky-50 via-blue-50 to-blue-50 min-h-screen">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-sky-700 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <Mail size={26} className="text-sky-600" />
            Daily Email Usage
          </h1>
          <p className="text-slate-600 mt-1">
            Live quota overview · resets 5:00 PM IST
          </p>
        </div>

        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-slate-400">
              Updated {fromNow(lastUpdated)}
            </span>
          )}
          <button
            onClick={() => fetchData(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white text-xs font-semibold shadow-lg shadow-sky-500/30 hover:shadow-xl hover:shadow-sky-500/40 active:scale-95 transition-all duration-200"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Summary Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          iconBg="bg-gradient-to-br from-sky-100 to-blue-100"
          icon={<Users size={20} className="text-sky-600" />}
          label="Total Users"
          value={data?.users?.length ?? 0}
          sub="active accounts"
        />
        <SummaryCard
          iconBg="bg-gradient-to-br from-blue-100 to-cyan-100"
          icon={<Radio size={20} className="text-blue-600" />}
          label="Currently Sending"
          value={sendingNow}
          sub="campaigns live now"
        />
        <SummaryCard
          iconBg="bg-gradient-to-br from-sky-100 to-blue-100"
          icon={<Zap size={20} className="text-sky-600" />}
          label="Sent Today"
          value={totalSentToday.toLocaleString()}
          sub="across all users"
        />
        <SummaryCard
          iconBg="bg-gradient-to-br from-red-100 to-rose-100"
          icon={<CheckCircle2 size={20} className="text-red-500" />}
          label="Limit Reached"
          value={counts.completed ?? 0}
          sub="users at 5,000 / day"
        />
      </div>

      {/* ── Filter Tabs + Search ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">

        <div className="flex items-center gap-1 bg-white/80 backdrop-blur-sm border border-sky-100 shadow-lg p-1 rounded-xl">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                filter === tab.key
                  ? "bg-gradient-to-r from-sky-600 to-blue-600 shadow-sm text-white"
                  : "text-slate-500 hover:text-sky-700 hover:bg-sky-50"
              }`}
            >
              {tab.label}
              {tab.key !== "all" && counts[tab.key] != null && (
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                  filter === tab.key
                    ? "bg-white/25 text-white"
                    : "bg-sky-100 text-sky-700"
                }`}>
                  {counts[tab.key]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-400" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search name, Emp ID, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-2.5 rounded-xl border-2 border-sky-200 text-xs w-64 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 bg-white placeholder-slate-400 text-slate-700 transition-all duration-200"
          />
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-sky-100 shadow-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sky-100 bg-gradient-to-r from-sky-50 to-blue-50">
              <th className="px-5 py-3.5 text-left text-[11px] font-bold text-sky-700 uppercase tracking-wider">
                User
              </th>
              <th className="px-5 py-3.5 text-left text-[11px] font-bold text-sky-700 uppercase tracking-wider">
                Status
              </th>
              <th className="px-5 py-3.5 text-left text-[11px] font-bold text-sky-700 uppercase tracking-wider hidden md:table-cell">
                Progress
              </th>
              <th className="px-5 py-3.5 text-right text-[11px] font-bold text-sky-700 uppercase tracking-wider">
                Sent
              </th>
              <th className="px-5 py-3.5 text-right text-[11px] font-bold text-sky-700 uppercase tracking-wider">
                Remaining
              </th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-14 text-slate-400 text-sm">
                  No users match your filter.
                </td>
              </tr>
            ) : (
              paginated.map((u, index) => {
                const cfg = STATUS_CONFIG[u.status] || STATUS_CONFIG.idle;
                const pct = Math.round(((u.dailySent || 0) / DAILY_LIMIT) * 100);

                return (
                  <tr
                    key={u.userId}
                    className={`border-b border-sky-50 last:border-0 hover:bg-sky-50/50 transition-colors duration-150 ${
                      index % 2 === 0 ? "bg-white" : "bg-sky-50/20"
                    }`}
                  >
                    {/* User */}
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-slate-800 text-[15px]">{u.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {u.empId} · {u.jobRole}
                      </p>
                      <p className="text-xs text-slate-400 hidden md:block">{u.email}</p>
                    </td>

                    {/* Status badge */}
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                        {cfg.icon}
                        {cfg.label}
                      </span>
                    </td>

                    {/* Progress bar */}
                    <td className="px-5 py-3.5 hidden md:table-cell w-40">
                      <ProgressBar pct={pct} />
                    </td>

                    {/* Sent */}
                    <td className="px-5 py-3.5 text-right font-semibold text-slate-700 text-[15px]">
                      {(u.dailySent || 0).toLocaleString()}
                    </td>

                    {/* Remaining */}
                    <td className="px-5 py-3.5 text-right">
                      <span className={`font-semibold text-[15px] ${
                        (u.remaining || 0) <= 500 ? "text-red-500" : "text-sky-600"
                      }`}>
                        {(u.remaining || 0).toLocaleString()}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* ── Pagination ──────────────────────────────────────────────────── */}
        {visible.length > PAGE_SIZE && (
          <Pagination
            page={safePage}
            totalPages={totalPages}
            totalItems={visible.length}
            pageSize={PAGE_SIZE}
            onPrev={(steps) => setPage(p => Math.max(1, p - steps))}
            onNext={(steps) => setPage(p => Math.min(totalPages, p + steps))}
          />
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <p className="text-xs text-slate-400 text-center pb-2">
        Auto-refreshes every 15 seconds · Quota resets daily at 5:00 PM IST · Limit: 5,000 emails / user / day
      </p>
    </div>
  );
}