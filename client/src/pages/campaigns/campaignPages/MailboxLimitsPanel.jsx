// src/pages/campaigns/campaignPages/MailboxLimitsPanel.jsx
//
// Every mailbox's daily sending limit, from GET /api/campaigns/mailbox-limits:
//   Total limit (by provider) · Sent today · Remaining today · Pending
// Pending = unsent emails in sending/scheduled campaigns for that mailbox.
// Emails beyond today's remaining stay queued and go out after the reset.
import { useMemo, useState } from "react";
import { AlertTriangle, Clock, Mail, Gauge } from "lucide-react";
import { useMailboxLimits } from "./mailboxLimitsStore";

const n = (v) => (v == null ? "—" : Number(v).toLocaleString());

function formatIn(date) {
  if (!date) return "";
  const mins = Math.max(0, Math.round((date.getTime() - Date.now()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function UsageBar({ pct, reached }) {
  const color = reached
    ? "bg-red-500"
    : pct >= 85
      ? "bg-amber-400"
      : "bg-sky-500";
  return (
    <div
      className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden mt-1"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function MailboxLimitsPanel() {
  const { loaded, accounts, resetsAt, providerLimits } = useMailboxLimits();
  const [onlyBusy, setOnlyBusy] = useState(false);

  const rows = useMemo(() => {
    const list = onlyBusy
      ? accounts.filter((a) => a.pending > 0 || a.sentToday > 0)
      : accounts;
    // Full mailboxes with work waiting first, then by pending.
    return [...list].sort(
      (a, b) =>
        Number(b.limitReached && b.pending > 0) -
          Number(a.limitReached && a.pending > 0) ||
        b.pending - a.pending ||
        a.email.localeCompare(b.email),
    );
  }, [accounts, onlyBusy]);

  if (!loaded || accounts.length === 0) return null;

  const waiting = accounts.filter((a) => a.afterReset > 0);
  const resetTime = resetsAt
    ? resetsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "5:00 PM IST";

  return (
    <section className="bg-white/80 backdrop-blur-sm rounded-2xl border border-sky-200/50 shadow-sm mb-6 sm:mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6 pt-4 pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
            <Gauge size={18} className="text-sky-600" />
            Mailbox daily limits
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Gmail {n(providerLimits.gmail)}, Google Workspace{" "}
            {n(providerLimits.gsuite)}, Yahoo {n(providerLimits.yahoo)},
            Rediff {n(providerLimits.rediff)} emails per mailbox per day.
            Counts reset at {resetTime}
            {resetsAt ? ` (in ${formatIn(resetsAt)})` : ""}.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyBusy}
            onChange={(e) => setOnlyBusy(e.target.checked)}
            className="w-4 h-4 text-sky-600 border-sky-300 rounded focus:ring-sky-500"
          />
          Only mailboxes in use today
        </label>
      </div>

      {waiting.length > 0 && (
        <div className="mx-4 sm:mx-6 mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            {n(waiting.reduce((s, a) => s + a.afterReset, 0))} email(s) across{" "}
            {waiting.length} mailbox{waiting.length > 1 ? "es" : ""} exceed
            today's limit. They stay queued and send automatically after the
            reset — nothing is cancelled.
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="bg-sky-50 border-y border-sky-100 text-left text-xs font-semibold text-sky-700">
              <th className="px-4 sm:px-6 py-2.5">Mailbox</th>
              <th className="px-3 py-2.5">Sent today / total limit</th>
              <th className="px-3 py-2.5 text-right">Remaining</th>
              <th className="px-3 py-2.5 text-right">Pending</th>
              <th className="px-4 sm:px-6 py-2.5">Today / after reset</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sky-50">
            {rows.map((a) => {
              const capped = a.dailyLimit != null;
              return (
                <tr key={a.id} className="align-top">
                  <td className="px-4 sm:px-6 py-2.5">
                    <div className="flex items-center gap-1.5 font-medium text-slate-800">
                      <Mail size={12} className="text-sky-500 flex-shrink-0" />
                      <span className="truncate max-w-[240px]" title={a.email}>
                        {a.email}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 min-w-[180px]">
                    <span className="font-semibold text-slate-800">
                      {a.providerLabel}: {n(a.sentToday)}
                    </span>
                    <span className="text-slate-500">
                      {capped ? ` / ${n(a.dailyLimit)} sent` : " sent"}
                    </span>
                    {capped ? (
                      <UsageBar pct={a.percentUsed} reached={a.limitReached} />
                    ) : (
                      <div className="text-[11px] text-slate-400">
                        No daily limit for this provider
                      </div>
                    )}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                      a.limitReached ? "text-red-600" : "text-slate-800"
                    }`}
                  >
                    {capped ? n(a.remaining) : "—"}
                    {a.limitReached && (
                      <div className="text-[11px] font-medium">Limit reached</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className="font-semibold text-slate-800">
                      {a.pendingIsEstimate ? "≈" : ""}
                      {n(a.pending)}
                    </span>
                    {a.pendingIsEstimate && (
                      <div
                        className="text-[11px] text-slate-500"
                        title="Normal campaigns share one queue between their mailboxes; this is this mailbox's share."
                      >
                        incl. shared queue
                      </div>
                    )}
                  </td>
                  <td className="px-4 sm:px-6 py-2.5 text-[12px] text-slate-600">
                    {a.pending === 0 ? (
                      <span className="text-slate-400">Nothing queued</span>
                    ) : (
                      <>
                        <div>{n(a.sendableToday)} today</div>
                        {a.afterReset > 0 && (
                          <div className="flex items-center gap-1 text-amber-700 font-medium">
                            <Clock size={11} />
                            {n(a.afterReset)} after reset
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}