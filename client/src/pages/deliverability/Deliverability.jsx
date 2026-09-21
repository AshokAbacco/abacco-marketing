// src/pages/deliverability/Deliverability.jsx
//
// Admin/HR page: do-not-contact list, "remove me" review queue and
// sending-account health.

import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  Ban,
  MessageSquareWarning,
  Activity,
  RefreshCw,
  Search,
  Plus,
  Trash2,
  Download,
  Pause,
  Play,
  X,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Globe,
  Gauge,
  Sliders,
  Flame,
} from "lucide-react";
import { api } from "../utils/api";

const REASON_LABELS = {
  unsubscribe: "Unsubscribed",
  reply_request: "Asked to be removed",
  hard_bounce: "Hard bounce",
  soft_bounce: "Repeated soft bounces",
  manual: "Added manually",
  import: "Imported",
};

const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");
const errMsg = (err, fallback) =>
  err?.response?.data?.message || err?.response?.data?.error || fallback;

function StatCard({ icon, label, value, tone = "sky" }) {
  const Icon = icon;
  const tones = {
    sky: "bg-sky-50 text-sky-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4">
      <div className={`p-3 rounded-xl ${tones[tone]}`}>
        <Icon size={22} />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 p-3 text-sm text-slate-600">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
        aria-label="Previous page"
      >
        <ChevronLeft size={16} />
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
        aria-label="Next page"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/* ── Suppression list ─────────────────────────────────────────────────── */
function AddModal({ onClose, onAdded }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post("/api/deliverability/suppressions", {
        emails: text,
        note: note || undefined,
        reason:
          text.split(/[\s,;]+/).filter(Boolean).length > 20
            ? "import"
            : "manual",
      });
      setResult(data);
      onAdded();
    } catch (err) {
      setError(errMsg(err, "Could not add addresses."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold text-slate-800">
            Add to do-not-contact list
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        {result ? (
          <div className="space-y-3 text-sm text-slate-700">
            <p className="flex items-center gap-2">
              <CheckCircle2 className="text-emerald-600" size={18} />{" "}
              {result.added} added, {result.alreadyListed} already listed.
            </p>
            {result.invalidCount > 0 && (
              <p className="text-amber-700">
                {result.invalidCount} invalid entr
                {result.invalidCount === 1 ? "y" : "ies"} skipped
                {result.invalid?.length
                  ? `: ${result.invalid.slice(0, 5).join(", ")}${result.invalidCount > 5 ? "…" : ""}`
                  : ""}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-lg bg-sky-600 text-white font-semibold"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm text-slate-600">
              Paste addresses separated by commas, spaces or new lines (up to
              20,000). Pending campaign emails to them are skipped immediately.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              required
              className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              placeholder={"someone@example.com\nother@example.org"}
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Note (optional), e.g. 'Client request 12 Oct'"
            />
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={saving || !text.trim()}
              className="w-full py-2.5 rounded-lg bg-sky-600 text-white font-semibold disabled:opacity-60"
            >
              {saving ? "Adding…" : "Add addresses"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function SuppressionTab({ onChanged }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/api/deliverability/suppressions", {
        params: {
          page,
          pageSize,
          search: query || undefined,
          reason: reason || undefined,
        },
      });
      setRows(data.data);
      setTotal(data.pagination.total);
    } catch (err) {
      setError(errMsg(err, "Could not load the list."));
    } finally {
      setLoading(false);
    }
  }, [page, query, reason]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (row) => {
    if (
      !window.confirm(
        `Remove ${row.email} from the do-not-contact list? They may receive campaign emails again.`,
      )
    )
      return;
    try {
      await api.delete(`/api/deliverability/suppressions/${row.id}`);
      load();
      onChanged();
    } catch (err) {
      alert(errMsg(err, "Could not remove the address."));
    }
  };

  const exportCsv = async () => {
    try {
      const res = await api.get("/api/deliverability/suppressions/export", {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `suppression-list-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(errMsg(err, "Export failed."));
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <div className="p-4 flex flex-wrap gap-3 items-center justify-between border-b border-slate-100">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
          className="flex gap-2 flex-1 min-w-[240px]"
        >
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search email…"
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <select
            value={reason}
            onChange={(e) => {
              setPage(1);
              setReason(e.target.value);
            }}
            className="border border-slate-300 rounded-lg px-2 py-2 text-sm"
            aria-label="Filter by reason"
          >
            <option value="">All reasons</option>
            {Object.entries(REASON_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </form>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download size={16} /> Export CSV
          </button>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700"
          >
            <Plus size={16} /> Add addresses
          </button>
        </div>
      </div>

      {error && (
        <p className="p-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Reason</th>
              <th className="text-left p-3">Source</th>
              <th className="text-left p-3">Note</th>
              <th className="text-left p-3">Added</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-3 font-medium text-slate-800">{r.email}</td>
                <td className="p-3">{REASON_LABELS[r.reason] || r.reason}</td>
                <td className="p-3 text-slate-500">{r.source || "—"}</td>
                <td
                  className="p-3 text-slate-500 max-w-xs truncate"
                  title={r.note || ""}
                >
                  {r.note || "—"}
                </td>
                <td className="p-3 text-slate-500 whitespace-nowrap">
                  {fmtDate(r.createdAt)}
                </td>
                <td className="p-3 text-right">
                  <button
                    type="button"
                    onClick={() => remove(r)}
                    className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"
                    title="Remove from list"
                    aria-label={`Remove ${r.email}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  No addresses found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
      <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      {adding && (
        <AddModal
          onClose={() => setAdding(false)}
          onAdded={() => {
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/* ── Review queue ─────────────────────────────────────────────────────── */
function ReviewTab({ onChanged }) {
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/api/deliverability/reviews", {
        params: { status, page, pageSize },
      });
      setRows(data.data);
      setTotal(data.pagination.total);
    } catch (err) {
      setError(errMsg(err, "Could not load the review queue."));
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (row, action) => {
    setBusyId(row.id);
    try {
      await api.post(`/api/deliverability/reviews/${row.id}`, { action });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setTotal((t) => Math.max(0, t - 1));
      onChanged();
    } catch (err) {
      alert(errMsg(err, "Action failed."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
        <p className="text-sm text-slate-600 max-w-2xl">
          Replies that look like “remove me / unsubscribe”. Confirm to stop all
          future emails to that person, or dismiss if it's a normal reply.
        </p>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          {["pending", "suppressed", "dismissed"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setPage(1);
                setStatus(s);
              }}
              className={`px-3 py-1.5 capitalize ${status === s ? "bg-sky-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="p-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li
            key={r.id}
            className="p-4 flex flex-col md:flex-row md:items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800">
                {r.email}
                {r.fromEmail && r.fromEmail !== r.email && (
                  <span className="font-normal text-slate-500">
                    {" "}
                    (replied as {r.fromEmail})
                  </span>
                )}
              </p>
              <p className="text-sm text-slate-500 truncate">
                {r.subject || "(no subject)"} · to{" "}
                {r.accountEmail || `account ${r.accountId}`} ·{" "}
                {fmtDate(r.receivedAt)}
              </p>
              <p className="mt-1 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 break-words">
                “{r.snippet || "—"}”
              </p>
            </div>
            {status === "pending" && (
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => resolve(r, "suppress")}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-60"
                >
                  <Ban size={15} /> Stop emailing
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => resolve(r, "dismiss")}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 disabled:opacity-60"
                >
                  Dismiss
                </button>
              </div>
            )}
          </li>
        ))}
        {!loading && rows.length === 0 && (
          <li className="p-8 text-center text-slate-500">Nothing here.</li>
        )}
      </ul>
      {loading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
      <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
    </div>
  );
}

/* ── Account health ───────────────────────────────────────────────────── */
function HealthTab({ onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/api/deliverability/accounts");
      setRows(data.data);
    } catch (err) {
      setError(errMsg(err, "Could not load account health."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (row, action) => {
    if (
      action === "pause" &&
      !window.confirm(
        `Pause sending from ${row.email}? Its campaign emails will wait until you resume it.`,
      )
    )
      return;
    setBusyId(row.id);
    try {
      await api.post(
        `/api/deliverability/accounts/${row.id}/${action}`,
        action === "pause" ? { reason: "Paused manually" } : {},
      );
      await load();
      onChanged();
    } catch (err) {
      alert(errMsg(err, "Action failed."));
    } finally {
      setBusyId(null);
    }
  };

  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  const badge = {
    healthy: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    paused: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
        <p className="text-sm text-slate-600 max-w-2xl">
          Accounts pause automatically after a bounce spike, a provider
          sending-limit error, or a login failure. Limit pauses lift on their
          own; login pauses lift when the app password is updated.
        </p>
        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Sliders size={16} /> Default limits
          </button>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-2 text-sm"
            aria-label="Filter accounts"
          >
            <option value="all">All accounts ({rows.length})</option>
            <option value="paused">
              Paused ({rows.filter((r) => r.status === "paused").length})
            </option>
            <option value="warning">
              Warning ({rows.filter((r) => r.status === "warning").length})
            </option>
            <option value="healthy">
              Healthy ({rows.filter((r) => r.status === "healthy").length})
            </option>
          </select>
        </div>
      </div>
      {error && (
        <p className="p-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left p-3">Account</th>
              <th className="text-left p-3">Owner</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Today / cap</th>
              <th className="text-right p-3">Sent 24h</th>
              <th className="text-right p-3">Hard / Block 24h</th>
              <th className="text-right p-3">Bounce 7d</th>
              <th className="text-right p-3">Reply 7d</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="p-3">
                  <p className="font-medium text-slate-800">{r.email}</p>
                  {r.sendingPausedReason && (
                    <p className="text-xs text-red-600 mt-0.5 max-w-sm">
                      {r.sendingPausedReason}
                      {r.sendingPausedUntil
                        ? ` · until ${fmtDate(r.sendingPausedUntil)}`
                        : " · until resumed"}
                    </p>
                  )}
                </td>
                <td className="p-3 text-slate-600">
                  {r.ownerName || r.ownerEmail}
                </td>
                <td className="p-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold capitalize ${badge[r.status]}`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <span
                    className={
                      r.capReached ? "text-amber-600 font-semibold" : ""
                    }
                  >
                    {r.sentToday}
                  </span>
                  <span className="text-slate-400">
                    {" "}
                    / {r.dailyLimit ?? "∞"}
                  </span>
                  {r.limitSource === "warmup" && (
                    <span
                      className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-orange-600"
                      title={`Warm-up day ${r.warmupDay}`}
                    >
                      <Flame size={11} />
                      {r.warmupDay}
                    </span>
                  )}
                  {r.limitSource === "manual" && (
                    <span className="ml-1 text-[11px] text-slate-400">
                      manual
                    </span>
                  )}
                </td>
                <td className="p-3 text-right">{r.sent24}</td>
                <td className="p-3 text-right">
                  {r.hard24} / {r.block24}
                </td>
                <td
                  className={`p-3 text-right ${r.bounceRate7d >= 5 ? "text-red-600 font-semibold" : ""}`}
                >
                  {r.bounceRate7d}%
                </td>
                <td className="p-3 text-right">{r.replyRate7d}%</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setEditing(r)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 mr-1 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold"
                    title="Daily cap and warm-up"
                  >
                    <Gauge size={13} /> Limit
                  </button>
                  {r.status === "paused" ? (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => act(r, "resume")}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-60"
                    >
                      <Play size={13} /> Resume
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => act(r, "pause")}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold disabled:opacity-60"
                    >
                      <Pause size={13} /> Pause
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-500">
                  No accounts.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
      {editing && (
        <LimitsModal
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            onChanged();
          }}
        />
      )}
      {showSettings && (
        <SendingLimitsModal
          onClose={() => {
            setShowSettings(false);
            load();
          }}
        />
      )}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
/* ── Overview: trends + domain authentication (Phase 4) ──────────────── */
function TrendBars({ days }) {
  const max = Math.max(1, ...days.map((d) => d.sent));
  return (
    <div
      className="flex items-end gap-1 h-32"
      role="img"
      aria-label="Emails sent per day"
    >
      {days.map((d) => {
        const bad = d.hard + d.soft + d.block;
        return (
          <div
            key={d.day}
            className="flex-1 flex flex-col items-center gap-1 min-w-[10px]"
            title={`${d.day}: ${d.sent} sent, ${d.replies} replies, ${bad} bounces, ${d.optouts} opt-outs`}
          >
            <div className="w-full flex flex-col justify-end h-28">
              <div
                className="w-full bg-sky-500 rounded-t"
                style={{ height: `${Math.round((d.sent / max) * 100)}%` }}
              />
              {bad > 0 && (
                <div
                  className="w-full bg-red-500"
                  style={{
                    height: `${Math.max(3, Math.round((bad / max) * 100))}%`,
                  }}
                />
              )}
            </div>
            <span className="text-[9px] text-slate-400">{d.day.slice(8)}</span>
          </div>
        );
      })}
    </div>
  );
}

function DomainRow({ d }) {
  const tone =
    d.status === "ok"
      ? "text-emerald-600"
      : d.status === "provider"
        ? "text-slate-500"
        : d.status === "partial"
          ? "text-amber-600"
          : "text-red-600";
  const mark = (ok) =>
    ok ? (
      <span className="text-emerald-600 font-semibold">pass</span>
    ) : (
      <span className="text-red-600 font-semibold">missing</span>
    );
  return (
    <li className="p-3 border-t border-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-800">
          {d.domain}{" "}
          <span className="text-xs font-normal text-slate-500">
            · {d.mailboxes} mailbox{d.mailboxes === 1 ? "" : "es"}
          </span>
        </p>
        <p className={`text-sm font-semibold capitalize ${tone}`}>
          {d.status === "provider" ? "provider-managed" : d.status}
        </p>
      </div>
      {!d.free && (
        <p className="text-xs text-slate-600 mt-1 flex flex-wrap gap-3">
          <span>SPF {mark(d.spf.ok)}</span>
          <span>
            DKIM {mark(d.dkim.ok)}
            {d.dkim.selector ? ` (${d.dkim.selector})` : ""}
          </span>
          <span>
            DMARC {mark(d.dmarc.ok)}
            {d.dmarc.policy ? ` (p=${d.dmarc.policy})` : ""}
          </span>
        </p>
      )}
      {d.note && <p className="text-xs text-slate-500 mt-1">{d.note}</p>}
    </li>
  );
}

function OverviewTab() {
  const [days, setDays] = useState(14);
  const [trends, setTrends] = useState(null);
  const [domains, setDomains] = useState(null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const [refreshingDns, setRefreshingDns] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get("/api/deliverability/trends", { params: { days } }),
      api.get("/api/deliverability/domains"),
    ])
      .then(([t, d]) => {
        if (!cancelled) {
          setTrends(t.data.data);
          setDomains(d.data.data);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errMsg(err, "Could not load the dashboard."));
      });
    return () => {
      cancelled = true;
    };
  }, [days, nonce]);

  const refreshDns = async () => {
    setRefreshingDns(true);
    try {
      const r = await api.get("/api/deliverability/domains", {
        params: { refresh: 1 },
      });
      setDomains(r.data.data);
    } catch (err) {
      setError(errMsg(err, "DNS check failed."));
    } finally {
      setRefreshingDns(false);
    }
  };

  const t = trends?.totals;
  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={BarChart3}
          label={`Emails sent (${days}d)`}
          value={t ? t.sent.toLocaleString() : "—"}
        />
        <StatCard
          icon={MessageSquareWarning}
          label="Reply rate"
          value={t ? `${t.replyRate}%` : "—"}
          tone="emerald"
        />
        <StatCard
          icon={AlertTriangle}
          label="Bounce rate"
          value={t ? `${t.bounceRate}%` : "—"}
          tone={t && t.bounceRate >= 5 ? "red" : "amber"}
        />
        <StatCard
          icon={Ban}
          label="Opt-out rate"
          value={t ? `${t.optoutRate}%` : "—"}
          tone="sky"
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-bold text-slate-800">
            Daily volume{" "}
            {trends?.scope === "mine" && (
              <span className="text-xs font-normal text-slate-500">
                · your mailboxes
              </span>
            )}
          </h2>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            aria-label="Period"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
        {trends ? (
          <TrendBars days={trends.days} />
        ) : (
          <p className="p-6 text-center text-sm text-slate-500">Loading…</p>
        )}
        <p className="text-xs text-slate-500 mt-2">
          Blue = sent, red = bounces. Keep bounces under 5% and watch for a
          falling reply rate.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200">
        <div className="p-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <Globe size={18} /> Sending domains
            </h2>
            <p className="text-xs text-slate-500">
              SPF, DKIM and DMARC tell providers your mail is genuine.
              Re-checked every 6 hours.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshDns}
            disabled={refreshingDns}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw size={16} />{" "}
            {refreshingDns ? "Checking…" : "Re-check DNS"}
          </button>
        </div>
        <ul>
          {(domains?.domains || []).map((d) => (
            <DomainRow key={d.domain} d={d} />
          ))}
        </ul>
        {domains && !domains.domains.length && (
          <p className="p-6 text-center text-sm text-slate-500">
            No sending mailboxes yet.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setNonce((n) => n + 1)}
        className="text-sm text-sky-700 font-semibold"
      >
        Refresh dashboard
      </button>
    </div>
  );
}

/* ── Per-mailbox cap / warm-up ───────────────────────────────────────── */
function LimitsModal({ account, onClose, onSaved }) {
  const [form, setForm] = useState({
    dailyCap: account.dailyCap ?? "",
    warmupEnabled: Boolean(account.warmupEnabled),
    warmupStartCap: account.warmupStartCap ?? "",
    warmupTarget: account.warmupTarget ?? "",
    restartWarmup: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.put(`/api/deliverability/accounts/${account.id}/limits`, {
        dailyCap: form.dailyCap === "" ? null : Number(form.dailyCap),
        warmupEnabled: form.warmupEnabled,
        warmupStartCap:
          form.warmupStartCap === "" ? null : Number(form.warmupStartCap),
        warmupTarget:
          form.warmupTarget === "" ? null : Number(form.warmupTarget),
        restartWarmup: form.restartWarmup,
      });
      onSaved();
    } catch (err) {
      setError(errMsg(err, "Could not save."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form
        onSubmit={save}
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">Sending limit</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        <p className="text-sm text-slate-600">
          {account.email} — currently{" "}
          <strong>{account.dailyLimit ?? "no limit"}</strong> per day (
          {account.limitSource}).
        </p>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-500 mb-1">
            Fixed daily cap (empty = warm-up or company default)
          </span>
          <input
            type="number"
            min="1"
            value={form.dailyCap}
            onChange={(e) => setForm({ ...form, dailyCap: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. 40"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.warmupEnabled}
            onChange={(e) =>
              setForm({ ...form, warmupEnabled: e.target.checked })
            }
          />
          Warm up this mailbox (raise the limit a little each day)
        </label>
        {form.warmupEnabled && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-slate-500 mb-1">
                Start at
              </span>
              <input
                type="number"
                min="1"
                value={form.warmupStartCap}
                onChange={(e) =>
                  setForm({ ...form, warmupStartCap: e.target.value })
                }
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder="10"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-500 mb-1">
                Target
              </span>
              <input
                type="number"
                min="1"
                value={form.warmupTarget}
                onChange={(e) =>
                  setForm({ ...form, warmupTarget: e.target.value })
                }
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder="100"
              />
            </label>
            {account.warmupStartAt && (
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.restartWarmup}
                  onChange={(e) =>
                    setForm({ ...form, restartWarmup: e.target.checked })
                  }
                />
                Start again from day 1
              </label>
            )}
          </div>
        )}
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SendingLimitsModal({ onClose }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/deliverability/settings/sending-limits")
      .then((r) => {
        if (!cancelled) setData(r.data);
      })
      .catch((err) => {
        if (!cancelled) setMsg(errMsg(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const settings = form || data?.data;
  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      await api.put("/api/deliverability/settings/sending-limits", settings);
      setMsg("Saved.");
      setForm(null);
    } catch (err) {
      setMsg(errMsg(err, "Could not save."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">
            Default sending limits
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        {!settings ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Used for mailboxes without their own cap. Free Gmail accounts
              should stay well under ~500/day; 100 or less is safer for cold
              email.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!data.canEdit}
                checked={settings.enabled}
                onChange={(e) =>
                  setForm({ ...settings, enabled: e.target.checked })
                }
              />
              Apply per-mailbox daily caps
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-semibold text-slate-500 mb-1">
                  Default cap
                </span>
                <input
                  type="number"
                  min="1"
                  disabled={!data.canEdit}
                  value={settings.defaultDailyCap}
                  onChange={(e) =>
                    setForm({
                      ...settings,
                      defaultDailyCap: Number(e.target.value),
                    })
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              {["startCap", "incrementPerDay", "targetCap"].map((k) => (
                <label key={k} className="block">
                  <span className="block text-xs font-semibold text-slate-500 mb-1">
                    {k === "startCap"
                      ? "Warm-up start"
                      : k === "incrementPerDay"
                        ? "Warm-up daily increase"
                        : "Warm-up target"}
                  </span>
                  <input
                    type="number"
                    min="1"
                    disabled={!data.canEdit}
                    value={settings.warmup[k]}
                    onChange={(e) =>
                      setForm({
                        ...settings,
                        warmup: {
                          ...settings.warmup,
                          [k]: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </label>
              ))}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1">
                Per provider
              </p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(settings.providerCaps).map(
                  ([provider, value]) => (
                    <label
                      key={provider}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="w-24 truncate capitalize">
                        {provider}
                      </span>
                      <input
                        type="number"
                        min="1"
                        disabled={!data.canEdit}
                        value={value}
                        onChange={(e) =>
                          setForm({
                            ...settings,
                            providerCaps: {
                              ...settings.providerCaps,
                              [provider]: Number(e.target.value),
                            },
                          })
                        }
                        className="w-24 border border-slate-300 rounded-lg px-2 py-1 text-sm"
                        aria-label={`Cap for ${provider}`}
                      />
                    </label>
                  ),
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                In use:{" "}
                {(data.providersInUse || [])
                  .map((x) => `${x.provider} (${x.accounts})`)
                  .join(", ") || "—"}
              </p>
            </div>
            {msg && (
              <p className="text-sm text-slate-600" role="status">
                {msg}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold"
              >
                Close
              </button>
              {data.canEdit && (
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !form}
                  className="px-3 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "health", label: "Account health", icon: Activity },
  { id: "reviews", label: "Removal requests", icon: MessageSquareWarning },
  { id: "suppression", label: "Do-not-contact list", icon: Ban },
];

export default function Deliverability() {
  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [summaryKey, setSummaryKey] = useState(0);

  const loadSummary = useCallback(() => setSummaryKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/deliverability/summary")
      .then(({ data }) => {
        if (!cancelled) setSummary(data.data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [summaryKey]);

  const bounced7d = summary
    ? (summary.bounces7d.hard || 0) + (summary.bounces7d.block || 0)
    : 0;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-sky-100 text-sky-700">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Deliverability
            </h1>
            <p className="text-sm text-slate-500">
              Replies, bounces, opt-outs and sending-account health
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            loadSummary();
            setRefreshKey((k) => k + 1);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {summary && !summary.publicUrlConfigured && (
        <div
          className="mb-4 flex gap-2 items-start rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          role="status"
        >
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span>
            PUBLIC_API_URL is not set on the server, so emails carry no
            unsubscribe link (only the mailto header). Set it to your public API
            address.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={MessageSquareWarning}
          label="Removal requests to review"
          value={summary?.pendingReviews ?? "—"}
          tone="amber"
        />
        <StatCard
          icon={Pause}
          label="Paused accounts"
          value={summary?.pausedAccounts ?? "—"}
          tone="red"
        />
        <StatCard
          icon={Activity}
          label="Replies (7 days)"
          value={summary?.replies7d ?? "—"}
          tone="emerald"
        />
        <StatCard
          icon={Ban}
          label={`Do-not-contact (${bounced7d} bounces / 7d)`}
          value={summary?.suppressedTotal ?? "—"}
          tone="sky"
        />
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto" role="tablist">
        {TABS.map(({ id, label, icon }) => {
          const TabIcon = icon;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap ${tab === id ? "bg-sky-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              <TabIcon size={16} /> {label}
              {id === "reviews" && summary?.pendingReviews > 0 && (
                <span
                  className={`ml-1 px-1.5 rounded-full text-xs ${tab === id ? "bg-white/25" : "bg-amber-100 text-amber-800"}`}
                >
                  {summary.pendingReviews}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div key={`${tab}-${refreshKey}`}>
        {tab === "overview" && <OverviewTab />}
        {tab === "health" && <HealthTab onChanged={loadSummary} />}
        {tab === "reviews" && <ReviewTab onChanged={loadSummary} />}
        {tab === "suppression" && <SuppressionTab onChanged={loadSummary} />}
      </div>
    </div>
  );
}
