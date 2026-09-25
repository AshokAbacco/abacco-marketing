// client/src/pages/campaigns/campaignPages/CampaignStatusPanel.jsx
//
// Plain-language campaign status for the CRM, from GET /api/campaigns/:id/status
//   • campaign number, status and WHY (sending / waiting / blocked / done)
//   • when it will complete (realistic ETA) and current speed
//   • why recipients are pending, failed or skipped
//   • every mailbox: state, limit/hr, sent today vs daily cap, resume time
//
// <CampaignStatusPanel campaignId={id} />          full panel
// <CampaignStatusPanel campaignId={id} compact />  one-line reason (list rows)
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Mail,
  XCircle,
  Hourglass,
  Server,
} from "lucide-react";
import { api } from "../../utils/api";
import { startVisiblePolling } from "../../utils/polling";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const SEVERITY = {
  ok: {
    box: "bg-emerald-50 border-emerald-200 text-emerald-800",
    dot: "bg-emerald-500",
    Icon: CheckCircle2,
  },
  info: {
    box: "bg-sky-50 border-sky-200 text-sky-800",
    dot: "bg-sky-500",
    Icon: Info,
  },
  warning: {
    box: "bg-amber-50 border-amber-200 text-amber-800",
    dot: "bg-amber-500",
    Icon: Hourglass,
  },
  error: {
    box: "bg-red-50 border-red-200 text-red-800",
    dot: "bg-red-500",
    Icon: XCircle,
  },
};

const STATE_LABEL = {
  sending: "Sending",
  hourly_limit: "Hourly limit used",
  done: "Done",
  not_running: "Idle",
  daily_cap: "Daily limit reached",
  company_limit: "Company limit",
  provider_limit: "Provider refused — retrying",
  cooldown: "Cooldown",
  login_failed: "Login failed",
  admin_paused: "Paused by admin",
  removed: "Deleted",
};

const fmt = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "—";

const n = (v) => (v ?? 0).toLocaleString();

const StatBox = ({ label, value, tone = "text-slate-900" }) => (
  <div className="bg-white/80 rounded-xl border border-sky-100 p-3">
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
      {label}
    </p>
    <p className={`text-lg font-bold ${tone}`}>{value}</p>
  </div>
);

const ReasonList = ({ title, items, tone }) =>
  items?.length ? (
    <div className="bg-white/80 rounded-xl border border-sky-100 p-4">
      <h5 className={`text-xs font-bold uppercase tracking-wide mb-2 ${tone}`}>
        {title}
      </h5>
      <ul className="space-y-1.5">
        {items.map((r) => (
          <li key={r.reason} className="flex justify-between gap-3 text-sm">
            <span className="text-slate-700 break-words min-w-0">
              {r.reason}
            </span>
            <span className="font-bold text-slate-900 flex-shrink-0">
              {n(r.count)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

export default function CampaignStatusPanel({
  campaignId,
  compact = false,
  onChanged,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Pause / Resend — any time, by the user only.
  const pauseOrResend = async (action) => {
    const text =
      action === "stop"
        ? "Pause this campaign? Already-sent emails are kept. Click Resend any time to continue where it stopped."
        : "Resend this campaign? It continues exactly where it stopped — nobody who already got it is emailed again.";
    if (!window.confirm(text)) return;
    try {
      setBusy(true);
      const res = await api.post(
        `${API_BASE_URL}/api/campaigns/${campaignId}/${action}`,
      );
      alert(res.data?.message || "Done");
      setReloadKey((k) => k + 1);
      onChanged?.();
    } catch (err) {
      alert(err.response?.data?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  // Cancel unsent emails (whole campaign, or one mailbox). Sent emails,
  // replies and history are kept; the campaign completes when nothing is left.
  const cancelPending = async (accountId, email, count) => {
    const text = accountId
      ? `Cancel the ${count} unsent email(s) of ${email}?\n\nAlready-sent emails are kept. This can't be undone.`
      : `Cancel all ${count} unsent email(s) and finish this campaign?\n\nAlready-sent emails, replies and history are kept. This can't be undone.`;
    if (!window.confirm(text)) return;
    try {
      setBusy(true);
      const res = await api.post(
        `${API_BASE_URL}/api/campaigns/${campaignId}/cancel-pending`,
        accountId ? { accountId } : {},
      );
      alert(res.data?.message || "Done");
      setReloadKey((k) => k + 1);
      onChanged?.();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to cancel unsent emails");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get(
          `${API_BASE_URL}/api/campaigns/${campaignId}/status`,
        );
        if (alive && res.data?.success) {
          setData(res.data.data);
          setError("");
        }
      } catch (err) {
        if (alive)
          setError(err.response?.data?.message || "Could not load status");
      }
    };
    load();
    const stop = startVisiblePolling(load, compact ? 30000 : 10000);
    return () => {
      alive = false;
      stop();
    };
  }, [campaignId, compact, reloadKey]);

  if (!data) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 p-4">
        {error ? (
          <AlertTriangle size={14} className="text-red-500" />
        ) : (
          <Loader2 size={14} className="animate-spin" />
        )}
        {error || "Loading campaign status…"}
      </div>
    );
  }

  const {
    campaign,
    summary,
    counts,
    eta,
    pendingReasons,
    failedReasons,
    skippedReasons,
    mailboxes,
    company,
    worker,
  } = data;
  const sev = SEVERITY[summary.severity] || SEVERITY.info;

  if (compact) {
    return (
      <div
        className="flex items-start gap-1.5 mt-1 text-[11px] leading-snug text-slate-600 max-w-md"
        title={summary.message}
      >
        <span
          className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${sev.dot}`}
        />
        <span className="line-clamp-2">
          <b className="font-semibold">{summary.title}</b>
          {eta?.at && summary.code === "sending"
            ? ` · done ~${fmt(eta.at)}`
            : ""}
          {summary.code !== "sending" && summary.message
            ? ` · ${summary.message}`
            : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Headline */}
      <div className={`rounded-2xl border p-4 ${sev.box}`}>
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <sev.Icon size={18} />
          <span className="text-xs font-bold bg-white/70 px-2 py-0.5 rounded-full">
            Campaign {campaign.number}
          </span>
          <span className="font-bold">{summary.title}</span>
          {campaign.followupOf && (
            <span className="text-xs bg-white/70 px-2 py-0.5 rounded-full">
              Follow-up of #{campaign.followupOf.id} {campaign.followupOf.name}
            </span>
          )}
        </div>
        <p className="text-sm">{summary.message}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {["sending", "scheduled"].includes(campaign.status) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => pauseOrResend("stop")}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
            >
              ⏸ Pause
            </button>
          )}
          {["stopped", "paused", "failed"].includes(campaign.status) &&
            counts.remaining > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => pauseOrResend("resend")}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
              >
                ▶ Resend ({n(counts.remaining)} left)
              </button>
            )}
        </div>
        {worker.otherWorker && (
          <p className="text-xs mt-2 flex items-start gap-1 font-semibold text-red-700">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            Two sending workers are running on this database (one on{" "}
            {String(worker.otherWorker).split(":")[0]}). Hourly limits are
            still respected, but stop the extra one.
          </p>
        )}
        {!worker.online && (
          <p className="text-xs mt-2 flex items-center gap-1">
            <Server size={12} /> Worker last seen:{" "}
            {worker.lastSeenAt ? fmt(worker.lastSeenAt) : "never"}
          </p>
        )}
      </div>

      {/* Progress */}
      <div className="bg-white/80 rounded-2xl border border-sky-100 p-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="font-semibold text-slate-700">
            {n(counts.total - counts.remaining)} of {n(counts.total)} processed
          </span>
          <span className="font-bold text-sky-700">{counts.percent}%</span>
        </div>
        <div className="h-2.5 bg-sky-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-blue-600"
            style={{ width: `${Math.min(100, counts.percent)}%` }}
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mt-4">
          <StatBox label="Total" value={n(counts.total)} />
          <StatBox
            label="Sent"
            value={n(counts.sent)}
            tone="text-emerald-700"
          />
          <StatBox
            label="Pending"
            value={n(counts.pending)}
            tone="text-amber-700"
          />
          <StatBox
            label="Sending now"
            value={n(counts.processing)}
            tone="text-blue-700"
          />
          <StatBox
            label="Failed"
            value={n(counts.failed)}
            tone="text-red-700"
          />
          <StatBox label="Skipped" value={n(counts.skipped)} />
          <StatBox
            label="Replied"
            value={n(counts.replied)}
            tone="text-purple-700"
          />
          <StatBox
            label="Bounced"
            value={n(counts.bounced)}
            tone="text-orange-700"
          />
        </div>
      </div>

      {/* Timing */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox
          label="Created"
          value={<span className="text-sm">{fmt(campaign.createdAt)}</span>}
        />
        <StatBox
          label={
            campaign.status === "scheduled" ? "Starts at" : "First email sent"
          }
          value={
            <span className="text-sm">
              {fmt(
                campaign.status === "scheduled"
                  ? campaign.scheduledAt
                  : campaign.firstSentAt,
              )}
            </span>
          }
        />
        <StatBox
          label={counts.remaining ? "Expected completion" : "Completed at"}
          value={
            <span className="text-sm">
              {counts.remaining
                ? eta.at
                  ? `${fmt(eta.at)} (in ${eta.in})`
                  : "Can't estimate"
                : fmt(campaign.lastSentAt)}
            </span>
          }
          tone={counts.remaining && !eta.at ? "text-red-700" : "text-slate-900"}
        />
        <StatBox
          label="Speed"
          value={
            <span className="text-sm">
              {n(counts.sentLastHour)} last hour · {n(counts.sentLast24h)} last
              24h · all mailboxes together max ~{n(eta.ratePerHour)}/hr
            </span>
          }
        />
      </div>
      {eta.note && counts.remaining > 0 && (
        <p className="text-xs text-slate-500 -mt-2 flex items-center gap-1">
          <Clock size={12} /> {eta.note} Company limit today:{" "}
          {n(company.sentToday)}/{n(company.dailyLimit)} (resets{" "}
          {fmt(company.resetsAt)}).
        </p>
      )}

      {/* Cancel unsent emails (keeps everything already sent) */}
      {counts.pending > 0 &&
        !["completed", "failed"].includes(campaign.status) && (
          <div className="flex flex-wrap items-center gap-3 bg-white/80 rounded-xl border border-red-100 p-3">
            <p className="text-xs text-slate-600 flex-1 min-w-[240px]">
              Emails stuck or no longer needed? Cancel the unsent ones —
              everything already sent (and its replies) is kept, and the
              campaign finishes.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => cancelPending(null, null, counts.pending)}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy
                ? "Cancelling…"
                : `Cancel ${n(counts.pending)} unsent email(s) & finish`}
            </button>
          </div>
        )}

      {/* Why */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <ReasonList
          title="Why still pending"
          items={pendingReasons}
          tone="text-amber-700"
        />
        <ReasonList
          title="Why failed"
          items={failedReasons}
          tone="text-red-700"
        />
        <ReasonList
          title="Why skipped"
          items={skippedReasons}
          tone="text-slate-600"
        />
      </div>

      {/* Mailboxes */}
      {mailboxes.length > 0 && (
        <div className="bg-white/80 rounded-2xl border border-sky-100 overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead>
              <tr className="bg-sky-50 border-b border-sky-100 text-left text-[11px] font-bold text-sky-700 uppercase tracking-wide">
                <th className="px-3 py-2.5">Mailbox</th>
                <th className="px-3 py-2.5">State / reason</th>
                <th className="px-3 py-2.5">Limit/hr</th>
                <th className="px-3 py-2.5">Daily limit (all campaigns)</th>
                <th className="px-3 py-2.5">Remaining today</th>
                <th className="px-3 py-2.5">Pending</th>
                <th className="px-3 py-2.5">Sent (this campaign)</th>
                <th className="px-3 py-2.5">Failed</th>
                <th className="px-3 py-2.5">Next send / resumes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-50">
              {mailboxes.map((m) => {
                const s = SEVERITY[m.severity] || SEVERITY.info;
                return (
                  <tr key={m.id} className="align-top">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 font-medium text-slate-800">
                        <Mail size={12} className="text-sky-500" /> {m.email}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {m.providerLabel || m.provider || "custom"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 max-w-xs">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${s.box}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                        {STATE_LABEL[m.state] || m.state}
                      </span>
                      <p className="text-[11px] text-slate-600 mt-1 break-words">
                        {m.message}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      {m.hourlyLimit}
                      {m.effectiveHourly !== m.hourlyLimit && (
                        <div className="text-[11px] text-slate-500">
                          ≈{m.effectiveHourly} (shared)
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-slate-800">
                        {m.providerLabel || "Mailbox"}: {n(m.sentToday)}
                      </span>
                      {m.dailyLimit != null ? (
                        <span className="text-slate-500">
                          {" "}
                          / {n(m.dailyLimit)} sent
                        </span>
                      ) : (
                        <div className="text-[11px] text-slate-400">
                          no daily limit
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2.5 font-semibold ${
                        m.remainingToday === 0
                          ? "text-red-600"
                          : "text-slate-800"
                      }`}
                    >
                      {m.remainingToday == null ? "—" : n(m.remainingToday)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-slate-800">
                        {m.pendingIsEstimate ? "≈" : ""}
                        {n(m.pending)}
                      </span>
                      {m.afterReset > 0 && (
                        <div className="text-[11px] font-medium text-amber-700">
                          {n(m.sendableToday)} today, {n(m.afterReset)} after
                          reset
                        </div>
                      )}
                      {m.pendingIsEstimate && m.pending > 0 && (
                        <div className="text-[11px] text-slate-500">
                          share of the campaign queue
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 gap-2 flex items-center">
                      {n(m.sentByCampaign)}
                      {/* Per-mailbox cancel only where rows belong to a
                          mailbox (follow-ups); normal campaigns share one
                          queue, so their pending is only an estimate. */} 
                      {m.pending > 0 &&
                        !m.pendingIsEstimate &&
                        !["completed", "failed"].includes(campaign.status) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              cancelPending(m.id, m.email, m.pending)
                            }
                            className="mt-1 text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-50"
                          >
                            Cancel these {n(m.pending)}
                          </button>
                        )}
                    </td>
                    <td className="px-3 py-2.5">{n(m.failed)}</td>
                    <td className="px-3 py-2.5 text-[12px]">
                      {m.state === "sending"
                        ? fmt(m.nextSendAt)
                        : m.resumesAt
                          ? fmt(m.resumesAt)
                          : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}