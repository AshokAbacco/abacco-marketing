// src/pages/campaigns/campaignPages/Schedulemodal.jsx
//  Campaign View Modal: Displays campaign recipients, stats, and from-mails in a modal with tabs.
//
//  Redesign notes (visual/UX only — no backend or data-fetching logic changed):
//   - Single scroll region (the old version nested two independent `overflow-y-auto`
//     containers with mismatched max-heights, which is what caused the broken/janky
//     scrolling). Now it's one flex column: header stays put, everything else scrolls.
//   - Full-screen sheet on mobile, centered card on larger screens.
//   - The old 3-column recipient grid was unreadable on narrow screens (long emails
//     truncated in three cramped columns). Replaced with a single scrollable list.
//     Virtualization is kept for performance on large recipient lists.
//   - Copy mechanism is untouched: still four explicit actions — Copy All /
//     Processing / Completed / Failed — each calling the same copyEmails(list,
//     section) function as before, always visible regardless of which list is
//     on screen. A separate underline tab row below just switches which single
//     list is displayed; it does not change what gets copied.

import { useState, useEffect, useMemo } from "react";
import {
  X,
  Loader2,
  Users,
  CheckCircle,
  Clock,
  AlertCircle,
  Copy,
  Check,
  Mail,
} from "lucide-react";
import { api } from "../../utils/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// ─── Virtualized single-column email list ─────────────────────────────────────
// ✅ PERF: only renders the rows currently in view instead of the whole list —
// recipient lists can run into the hundreds/thousands.
const ROW_HEIGHT = 42;
const VISIBLE_ROWS = 9;

function EmailList({ emails, emptyLabel }) {
  const [scrollTop, setScrollTop] = useState(0);

  if (!emails.length) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
        <Users className="text-slate-300 mb-2" size={30} />
        <p className="text-sm text-slate-400 font-medium">{emptyLabel}</p>
      </div>
    );
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3);
  const endIndex = Math.min(emails.length, startIndex + VISIBLE_ROWS + 6);
  const visible = emails.slice(startIndex, endIndex);

  return (
    <div
      className="border border-slate-200 rounded-xl overflow-y-auto bg-white"
      style={{ maxHeight: ROW_HEIGHT * VISIBLE_ROWS }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: emails.length * ROW_HEIGHT, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: startIndex * ROW_HEIGHT,
            left: 0,
            right: 0,
          }}
        >
          {visible.map((email, i) => (
            <div
              key={startIndex + i}
              className="flex items-center gap-3 px-3 sm:px-4 border-b border-slate-100 last:border-b-0"
              style={{ height: ROW_HEIGHT }}
            >
              <span className="text-[11px] text-slate-400 w-6 sm:w-7 text-right flex-shrink-0 tabular-nums">
                {startIndex + i + 1}
              </span>
              <span className="text-sm text-slate-700 truncate">{email}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── From Mails & Subjects Tab ────────────────────────────────────────────────

// Extracts every unique from-email from all possible locations in the campaign object
function extractFromEmails(campaign) {
  const set = new Set();

  // ── From each recipient: check every plausible field name ──
  campaign.recipients?.forEach((r) => {
    const candidates = [
      r.sentFromEmail,
      r.fromEmail,
      r.assignedFromEmail,
      r.senderEmail,
      r.fromAddress,
      r.assignedEmail,
    ];
    candidates.forEach((v) => {
      if (v && typeof v === "string") set.add(v.trim());
    });
  });

  // ── Campaign-level arrays ──
  const arrayFields = [
    campaign.fromAccounts, // [{email, …}]
    campaign.fromEmails, // ['email@…']
    campaign.senderAccounts,
    campaign.emailAccounts,
    campaign.accounts,
  ];
  arrayFields.forEach((arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((item) => {
      if (!item) return;
      if (typeof item === "string") {
        set.add(item.trim());
        return;
      }
      const e =
        item.email ||
        item.fromEmail ||
        item.senderEmail ||
        item.address ||
        item.emailAddress;
      if (e && typeof e === "string") set.add(e.trim());
    });
  });

  // ── Campaign-level plain string fields ──
  ["fromEmail", "senderEmail", "fromAddress"].forEach((key) => {
    if (campaign[key] && typeof campaign[key] === "string")
      set.add(campaign[key].trim());
  });

  return [...set];
}

function FromMailsTab({ campaign }) {
  const [copiedItem, setCopiedItem] = useState(null);

  const fromEmailsList = useMemo(() => extractFromEmails(campaign), [campaign]);

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(key);
      setTimeout(() => setCopiedItem(null), 2000);
    } catch {}
  };

  const copyAll = () => copyText(fromEmailsList.join("\n"), "all-from");

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-sky-50 border-b border-gray-200">
          <div className="flex items-center gap-2 min-w-0">
            <Mail className="text-sky-600 flex-shrink-0" size={15} />
            <span className="text-sm font-bold text-sky-800 truncate">
              From Mails
            </span>
            <span className="bg-sky-100 text-sky-700 text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">
              {fromEmailsList.length}
            </span>
          </div>
          {fromEmailsList.length > 0 && (
            <button
              onClick={copyAll}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-medium transition-colors"
            >
              {copiedItem === "all-from" ? (
                <>
                  <Check size={12} /> Copied!
                </>
              ) : (
                <>
                  <Copy size={12} /> Copy All
                </>
              )}
            </button>
          )}
        </div>

        {/* ── Rows ── */}
        {fromEmailsList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <Mail className="text-gray-300 mb-3" size={36} />
            <p className="text-sm text-gray-400 font-medium">
              No from emails found
            </p>
          </div>
        ) : (
          <div className="max-h-[300px] overflow-y-auto">
            {fromEmailsList.map((email, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-gray-100 last:border-b-0 ${
                  i % 2 === 0 ? "bg-white" : "bg-gray-50/40"
                }`}
              >
                <span className="text-xs text-gray-400 w-6 text-right flex-shrink-0 tabular-nums">
                  {i + 1}
                </span>

                {/* Avatar */}
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <span className="text-white text-xs font-bold">
                    {email.charAt(0).toUpperCase()}
                  </span>
                </div>

                {/* Email */}
                <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">
                  {email}
                </span>

                {/* Copy button */}
                <button
                  onClick={() => copyText(email, `from-${i}`)}
                  className="flex-shrink-0 p-1.5 text-gray-300 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
                >
                  {copiedItem === `from-${i}` ? (
                    <Check size={13} className="text-sky-600" />
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Small building blocks ─────────────────────────────────────────────────────

const StatTile = ({ icon, label, value, tone }) => {
  const tones = {
    blue: {
      wrap: "from-blue-50 to-indigo-50 border-blue-200/50",
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
      label: "text-blue-700",
      value: "text-blue-900",
    },
    yellow: {
      wrap: "from-yellow-50 to-orange-50 border-yellow-200/50",
      iconBg: "bg-yellow-100",
      iconColor: "text-yellow-600",
      label: "text-yellow-700",
      value: "text-yellow-900",
    },
    sky: {
      wrap: "from-sky-50 to-blue-50 border-sky-200/50",
      iconBg: "bg-sky-100",
      iconColor: "text-sky-600",
      label: "text-sky-700",
      value: "text-sky-900",
    },
    red: {
      wrap: "from-red-50 to-pink-50 border-red-200/50",
      iconBg: "bg-red-100",
      iconColor: "text-red-600",
      label: "text-red-700",
      value: "text-red-900",
    },
  }[tone];

  return (
    <div
      className={`bg-gradient-to-br ${tones.wrap} rounded-xl p-3 sm:p-4 border shadow-sm min-w-0`}
    >
      <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
        <div className={`p-1.5 ${tones.iconBg} rounded-lg flex-shrink-0`}>
          {icon}
        </div>
        <span
          className={`text-[11px] sm:text-xs font-semibold ${tones.label} uppercase tracking-wide truncate`}
        >
          {label}
        </span>
      </div>
      <p className={`text-xl sm:text-2xl font-black ${tones.value}`}>{value}</p>
    </div>
  );
};

const STATUS_FILTERS = [
  { key: "all", label: "All", tone: "blue" },
  { key: "processing", label: "Processing", tone: "yellow" },
  { key: "completed", label: "Completed", tone: "sky" },
  { key: "failed", label: "Failed", tone: "red" },
];

const UNDERLINE_TONES = {
  blue: "bg-blue-600",
  yellow: "bg-yellow-500",
  sky: "bg-sky-600",
  red: "bg-red-600",
};

const COPY_BUTTON_TONES = {
  blue: "bg-blue-600 hover:bg-blue-700",
  yellow: "bg-yellow-500 hover:bg-yellow-600",
  sky: "bg-sky-600 hover:bg-sky-700",
  red: "bg-red-600 hover:bg-red-700",
};

// Same copy mechanism as before (navigator.clipboard.writeText of a
// newline-joined list) — just a compact reusable button so the four
// copy actions (All / Processing / Completed / Failed) stay visually
// consistent.
function CopyButton({ label, count, tone, copied, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={count === 0}
      className={`flex items-center justify-center gap-1.5 px-3 sm:px-3.5 py-2.5 sm:py-2 ${COPY_BUTTON_TONES[tone]} disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-sm transition-colors`}
    >
      {copied ? (
        <>
          <Check size={13} />
          Copied!
        </>
      ) : (
        <>
          <Copy size={13} />
          <span className="truncate">{label}</span>
          <span className="bg-black/15 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
            {count}
          </span>
        </>
      )}
    </button>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function CampaignView({ campaignId, onClose }) {
  const [data, setData] = useState(null);
  // ⚡ Full, unpaginated recipient list (every status), used for the
  // Copy/list/From Mails tab. `data.campaign.recipients` from /:id/view is
  // capped at pageSize (default 200, max 500) and must NOT be used for
  // "show me everything" lists — only `data.stats` (grouped counts) is
  // safe to read off /:id/view for totals.
  const [allRecipients, setAllRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedSection, setCopiedSection] = useState(null);
  const [activeTab, setActiveTab] = useState("recipients"); // "recipients" | "frommails"
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (campaignId) {
      fetchCampaign();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  const fetchCampaign = async () => {
    try {
      setLoading(true);
      setError(null);
      const [viewRes, recipientsRes] = await Promise.all([
        api.get(`${API_BASE_URL}/api/campaigns/${campaignId}/view`),
        api.get(`${API_BASE_URL}/api/campaigns/${campaignId}/recipients`),
      ]);

      if (viewRes.data.success) {
        setData(viewRes.data.data);
      } else {
        setError("Failed to load campaign data");
      }

      if (recipientsRes.data.success) {
        setAllRecipients(recipientsRes.data.data || []);
      } else {
        console.error(
          "Failed to load full recipient list:",
          recipientsRes.data,
        );
        setAllRecipients([]);
      }
    } catch (error) {
      console.error("Failed to fetch campaign:", error);
      setError(error.response?.data?.message || "Failed to load campaign");
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const copyEmails = async (emails, section) => {
    try {
      await navigator.clipboard.writeText(emails.join("\n"));
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch {}
  };

  const getRecipientsByStatus = (status) => {
    if (!allRecipients.length) return [];
    return allRecipients.filter((r) => {
      if (status === "completed")
        return r.status === "sent" || r.status === "completed";
      if (status === "processing")
        return r.status === "pending" || r.status === "processing";
      if (status === "failed")
        return r.status === "failed" || r.status === "error";
      return false;
    });
  };

  if (!campaignId) return null;

  const allEmails = allRecipients.map((r) => r.email);
  const processingEmails = getRecipientsByStatus("processing").map(
    (r) => r.email,
  );
  const completedEmails = getRecipientsByStatus("completed").map(
    (r) => r.email,
  );
  const failedEmails = getRecipientsByStatus("failed").map((r) => r.email);

  const emailsByFilter = {
    all: allEmails,
    processing: processingEmails,
    completed: completedEmails,
    failed: failedEmails,
  };
  const currentEmails = emailsByFilter[statusFilter] || allEmails;

  // From mails count for badge — uses same extractFromEmails helper as
  // FromMailsTab, but fed the full recipient list rather than the
  // paginated one on data.campaign.
  const fromMailsCount = data
    ? extractFromEmails({ ...data.campaign, recipients: allRecipients }).length
    : 0;

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[9999] sm:p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white w-full sm:max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[88vh] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fadeIn">
        {loading ? (
          <div className="flex flex-col items-center justify-center flex-1 p-16">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-sky-500 to-blue-600 rounded-full blur-xl opacity-30"></div>
              <Loader2
                className="relative animate-spin text-sky-600"
                size={44}
              />
            </div>
            <p className="text-gray-600 font-medium mt-4">
              Loading campaign details...
            </p>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 sm:p-16 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
              <AlertCircle className="text-red-600" size={32} />
            </div>
            <p className="text-red-600 text-lg font-semibold mb-6">{error}</p>
            <button
              onClick={fetchCampaign}
              className="px-6 py-3 bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-xl hover:from-sky-700 hover:to-blue-700 font-semibold shadow-lg shadow-sky-500/30 transition-all"
            >
              Retry
            </button>
          </div>
        ) : data ? (
          <>
            {/* ── Header (fixed, does not scroll) ─────────────────── */}
            <div className="flex-shrink-0 bg-gradient-to-r from-sky-50 via-blue-50 to-blue-50 border-b border-sky-200/50 px-4 sm:px-8 py-4 sm:py-6 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">
                  {data.campaign.name}
                </h2>
                <p className="text-xs sm:text-sm text-gray-600 mt-0.5">
                  Campaign recipients & statistics
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-white/60 rounded-full p-2 transition-all"
              >
                <X size={22} />
              </button>
            </div>

            {/* ── Body — the ONLY scroll region ───────────────────── */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-8">
              {/* Stats Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
                <StatTile
                  icon={<Users className="text-blue-600" size={18} />}
                  label="Total"
                  value={data.stats.total}
                  tone="blue"
                />
                <StatTile
                  icon={<Clock className="text-yellow-600" size={18} />}
                  label="Processing"
                  value={data.stats.processing}
                  tone="yellow"
                />
                <StatTile
                  icon={<CheckCircle className="text-sky-600" size={18} />}
                  label="Completed"
                  value={data.stats.completed}
                  tone="sky"
                />
                {data.stats.failed > 0 && (
                  <StatTile
                    icon={<AlertCircle className="text-red-600" size={18} />}
                    label="Failed"
                    value={data.stats.failed}
                    tone="red"
                  />
                )}
              </div>

              {/* Summary */}
              <div className="mb-6 p-3.5 sm:p-4 bg-gradient-to-r from-gray-50 to-slate-50 rounded-xl border border-gray-200">
                <p className="text-sm text-gray-700 font-medium">
                  Total Recipients{" "}
                  <span className="font-bold text-blue-600">
                    {data.stats.total}
                  </span>
                  , Processing count{" "}
                  <span className="font-bold text-yellow-600">
                    {data.stats.processing}
                  </span>
                  , Completed -{" "}
                  <span className="font-bold text-sky-600">
                    {data.stats.completed}
                  </span>
                  {data.stats.failed > 0 && (
                    <>
                      , Failed -{" "}
                      <span className="font-bold text-red-600">
                        {data.stats.failed}
                      </span>
                    </>
                  )}
                  {data.stats.skipped > 0 && (
                    <>
                      , Skipped -{" "}
                      <span
                        className="font-bold text-slate-600"
                        title="Do-not-contact list, or already replied"
                      >
                        {data.stats.skipped}
                      </span>
                    </>
                  )}
                </p>
                {(data.stats.replied > 0 ||
                  data.stats.bounced > 0 ||
                  data.stats.unsubscribed > 0) && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {data.stats.replied > 0 && (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                        {data.stats.replied} replied ({data.stats.replyRate}%)
                      </span>
                    )}
                    {data.stats.bounced > 0 && (
                      <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold">
                        {data.stats.bounced} bounced
                      </span>
                    )}
                    {data.stats.unsubscribed > 0 && (
                      <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold">
                        {data.stats.unsubscribed} unsubscribed
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* ── Main Tabs ──────────────────────────────────────── */}
              <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-full sm:w-fit overflow-x-auto">
                <button
                  onClick={() => setActiveTab("recipients")}
                  className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                    activeTab === "recipients"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Users size={15} />
                  Recipients
                  <span
                    className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                      activeTab === "recipients"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {data.stats.total}
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab("frommails")}
                  className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                    activeTab === "frommails"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Mail size={15} />
                  From Mails
                  {fromMailsCount > 0 && (
                    <span
                      className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                        activeTab === "frommails"
                          ? "bg-sky-100 text-sky-700"
                          : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {fromMailsCount}
                    </span>
                  )}
                </button>
              </div>

              {/* ── Tab Panels ─────────────────────────────────────── */}
              {activeTab === "recipients" && (
                <div>
                  {allRecipients.length > 0 ? (
                    <div>
                      {/* Copy actions — same four-way copy as the original
                          (All / Processing / Completed / Failed), always
                          available regardless of which list is being viewed
                          below. */}
                      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mb-5">
                        <CopyButton
                          label="Copy All"
                          count={allEmails.length}
                          tone="blue"
                          copied={copiedSection === "all"}
                          onClick={() => copyEmails(allEmails, "all")}
                        />
                        <CopyButton
                          label="Processing"
                          count={processingEmails.length}
                          tone="yellow"
                          copied={copiedSection === "processing"}
                          onClick={() =>
                            copyEmails(processingEmails, "processing")
                          }
                        />
                        <CopyButton
                          label="Completed"
                          count={completedEmails.length}
                          tone="sky"
                          copied={copiedSection === "completed"}
                          onClick={() =>
                            copyEmails(completedEmails, "completed")
                          }
                        />
                        {failedEmails.length > 0 && (
                          <CopyButton
                            label="Failed"
                            count={failedEmails.length}
                            tone="red"
                            copied={copiedSection === "failed"}
                            onClick={() => copyEmails(failedEmails, "failed")}
                          />
                        )}
                      </div>

                      {/* View switcher — decides which single list shows
                          below; purely a display filter, independent of the
                          copy actions above. */}
                      <div className="flex items-center gap-4 sm:gap-5 mb-3 overflow-x-auto -mx-1 px-1 border-b border-slate-100">
                        {STATUS_FILTERS.filter(
                          (f) => f.key !== "failed" || failedEmails.length > 0,
                        ).map((f) => (
                          <button
                            key={f.key}
                            onClick={() => setStatusFilter(f.key)}
                            className={`relative flex-shrink-0 pb-2.5 text-xs font-bold whitespace-nowrap transition-colors ${
                              statusFilter === f.key
                                ? "text-slate-900"
                                : "text-slate-400 hover:text-slate-600"
                            }`}
                          >
                            {f.label}
                            <span className="ml-1.5 text-slate-400">
                              {emailsByFilter[f.key].length}
                            </span>
                            {statusFilter === f.key && (
                              <span
                                className={`absolute left-0 right-0 -bottom-[1px] h-0.5 rounded-full ${UNDERLINE_TONES[f.tone]}`}
                              />
                            )}
                          </button>
                        ))}
                      </div>

                      <EmailList
                        emails={currentEmails}
                        emptyLabel={`No ${statusFilter === "all" ? "" : statusFilter + " "}recipients`}
                      />
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
                      <Users className="mx-auto text-gray-400 mb-3" size={48} />
                      <p className="text-gray-500 font-medium">
                        No recipients found
                      </p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "frommails" && (
                <FromMailsTab
                  campaign={{ ...data.campaign, recipients: allRecipients }}
                />
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
