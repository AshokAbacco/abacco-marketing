// client/src/pages/campaigns/CampaignList.jsx
//
// Redesign notes (visual/UX only — every API call, handler, and piece of
// state is unchanged):
//  - Header and tab bar now wrap/scroll instead of overflowing on narrow
//    screens.
//  - The campaigns table is shown on md+ screens inside a proper
//    horizontally-scrollable container (min-width forces scroll instead of
//    squishing columns unreadably). On small screens it's replaced with a
//    stacked card list — same data, same actions, no sideways scrolling
//    required to read a single row.
//  - CampaignProgress's inner table also got a horizontal-scroll wrapper —
//    it has 6 columns and was overflowing raw before.
//  - Stat cards go 2-up on mobile instead of stacking to one column.
import { useState, useEffect, useMemo, Fragment } from "react";
import {
  LayoutDashboard,
  Send,
  UserPlus,
  Users,
  TrendingUp,
  Mail,
  Calendar,
  Activity,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Clock,
  Play,
  CheckCircle2,
  Loader2,
  Search,
  Zap,
  Target,
  Award,
  StopCircle,
  PauseCircle,
  RotateCcw,
} from "lucide-react";
import CreateCampaign from "./campaignPages/CreateCampaign";
import CampaignDetail from "./campaignPages/CampaignDetail";
import CampaignView from "./campaignPages/Schedulemodal";
import DailyLimitBanner from "./campaignPages/DailyLimitBanner";

import { api } from "../utils/api";
import { startVisiblePolling } from "../utils/polling";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function CampaignList() {
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-blue-50 to-blue-50 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-0 left-1/4 w-96 h-96 bg-sky-200/20 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: "4s" }}
        ></div>
        <div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-200/20 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: "6s", animationDelay: "1s" }}
        ></div>
      </div>

      {/* Modern Header with Glass Effect */}
      <div className="bg-blue/20 backdrop-blur-xl border-b border-sky-200/50 sticky top-0 z-[100] shadow-sm">
        <div className="max-w-8xl mx-auto px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-y-3 py-4 sm:py-5">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-sky-500 to-blue-600 rounded-2xl blur opacity-50"></div>
                <div className="relative w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-sky-600 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-sky-500/30 transform transition-all hover:scale-110 hover:rotate-3">
                  <Mail className="text-white" size={20} />
                </div>
              </div>
              <div>
                <h1 className="text-xl sm:text-3xl font-bold bg-gradient-to-r from-sky-600 to-blue-600 bg-clip-text text-transparent">
                  Campaign Manager
                </h1>
                <p className="text-[11px] sm:text-xs text-slate-600 font-medium mt-0.5">
                  Manage & optimize your email campaigns
                </p>
              </div>
            </div>

            {/* Quick Stats Badge */}
            <div className="hidden md:flex items-center gap-3 bg-gradient-to-r from-sky-50 to-blue-50 px-4 py-1 rounded-xl border border-sky-200/50">
              <div className="flex items-center gap-1.5">
                <Zap className="text-slate-600" size={16} />
                <span className="text-xs font-semibold text-sky-700">
                  Active
                </span>
              </div>
              <div className="w-px h-4 bg-sky-200"></div>

              <DailyLimitBanner />
            </div>
          </div>

          {/* Enhanced Tab Navigation */}
          <div className="flex gap-1 -mb-px overflow-x-auto no-scrollbar">
            <TabButton
              active={activeTab === "dashboard"}
              onClick={() => setActiveTab("dashboard")}
              icon={<LayoutDashboard size={18} />}
              label="Dashboard"
            />
            <TabButton
              active={activeTab === "campaign"}
              onClick={() => setActiveTab("campaign")}
              icon={<Send size={18} />}
              label="Campaign"
            />
            <TabButton
              active={activeTab === "followup"}
              onClick={() => setActiveTab("followup")}
              icon={<UserPlus size={18} />}
              label="Follow-ups"
            />
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-8xl mx-auto px-4 sm:px-6 py-6 sm:py-8 relative z-10">
        {activeTab === "dashboard" && <DashboardTab />}
        {activeTab === "campaign" && <CreateCampaign />}
        {activeTab === "followup" && <CampaignDetail />}
      </div>
    </div>
  );
}

const CampaignProgress = ({ campaignId }) => {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    fetchProgress();
    // 10 s is plenty for a progress bar; paused in background tabs.
    return startVisiblePolling(fetchProgress, 10000);
  }, [campaignId]);

  const fetchProgress = async () => {
    try {
      const res = await api.get(
        `${API_BASE_URL}/api/campaigns/${campaignId}/progress`,
      );
      if (res.data.success) setRows(res.data.data);
    } catch (error) {
      console.error("Failed to fetch progress:", error);
    }
  };

  return (
    <div className="mt-4 bg-gradient-to-br from-sky-50 via-blue-50 to-blue-50 rounded-2xl p-4 sm:p-5 border border-sky-200/50 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 bg-sky-100 rounded-lg">
          <Activity className="text-slate-600" size={16} />
        </div>
        <h4 className="text-sm font-bold text-sky-900">
          Live Progress Tracking
        </h4>
        <span className="ml-auto text-xs bg-sky-100 text-sky-700 px-2 py-1 rounded-full font-medium">
          Real-time
        </span>
      </div>
      <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-sky-100 shadow-sm overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-sky-50 to-blue-50 border-b border-sky-100">
              <th className="px-4 py-3.5 text-left text-xs font-bold text-sky-600 uppercase tracking-wide">
                Email
              </th>
              <th className="px-4 py-3.5 text-left text-xs font-bold text-sky-600 uppercase tracking-wide">
                Domain
              </th>
              <th className="px-4 py-3.5 text-left text-xs font-bold text-sky-600 uppercase tracking-wide">
                Processing
              </th>
              <th className="px-4 py-3.5 text-left text-xs font-bold text-sky-600 uppercase tracking-wide">
                Completed
              </th>
              <th className="px-4 py-3.5 text-left text-xs font-bold text-sky-600 uppercase tracking-wide">
                Sending IP
              </th>
              <th className="px-4 py-3.5 text-left text-xs font-bold text-sky-600 uppercase tracking-wide">
                ETA
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sky-100">
            {rows.map((r) => (
              <tr
                key={r.email}
                className="hover:bg-sky-50/50 transition-colors"
              >
                <td className="px-4 py-3.5 text-slate-800 font-medium">
                  {r.email}
                </td>
                <td className="px-4 py-3.5 text-slate-600">{r.domain}</td>
                <td className="px-4 py-3.5">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                    {r.processing}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-100 text-sky-700 border border-sky-200">
                    {r.completed}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-slate-600">
                  {r.sendingIp || "—"}
                </td>
                <td className="px-4 py-3.5">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-100 text-purple-700 text-xs font-semibold border border-purple-200 whitespace-nowrap">
                    <Clock size={12} />
                    {r.processing > 0 ? `Sending  • ETA ${r.eta}` : `Completed`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const CampaignTiming = ({ campaign }) => {
  // ✅ FIX: estimatedCompletion is calculated ONCE at campaign creation in the
  // controller (recipients / hourlyCapacity) and stored in DB.
  // Do NOT recalculate on the frontend — the old live-rate formula caused the
  // Est. Completion time to keep shifting every 5s as the observed rate
  // fluctuated. The per-account countdown ETA lives in the progress table below.
  const isActive = campaign.status === "sending";

  const timing = useMemo(() => {
    const isCompleted =
      campaign.status === "completed" ||
      campaign.status === "completed_with_errors";
    if (!isActive && !isCompleted) {
      return {
        startTime: null,
        endTime: null,
        estimatedCompletion: null,
        duration: null,
      };
    }

    // Use campaign.createdAt as start time — always available and never stale.
    const startTime = campaign.createdAt ? new Date(campaign.createdAt) : null;

    // End time: from recipients for completed campaigns
    const endTime =
      isCompleted && campaign.lastSentAt ? new Date(campaign.lastSentAt) : null;

    // ✅ Always use the DB-stored estimatedCompletion — fixed at creation, never drifts.
    const estimatedCompletion = campaign.estimatedCompletion
      ? new Date(campaign.estimatedCompletion)
      : null;

    let duration = null;
    if (startTime && endTime) {
      const durationMs = endTime - startTime;
      const hours = Math.floor(durationMs / 3600000);
      const minutes = Math.floor((durationMs % 3600000) / 60000);
      duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    }

    return { startTime, endTime, duration, estimatedCompletion };
  }, [campaign, isActive]);

  return (
    <div className="bg-gradient-to-br from-sky-50 via-blue-50 to-blue-50 rounded-2xl p-4 sm:p-5 border border-sky-200/50 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 bg-sky-100 rounded-lg">
          <Clock className="text-slate-600" size={16} />
        </div>
        <h4 className="text-sm font-bold text-sky-700">Campaign Timeline</h4>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {timing.startTime && (
          <div className="group relative bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-sky-200/50 shadow-sm hover:shadow-md transition-all hover:border-sky-300">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1 bg-sky-100 rounded-lg">
                <Play className="text-slate-600" size={14} />
              </div>
              <span className="text-xs font-bold text-sky-700 uppercase tracking-wide">
                Start Time
              </span>
            </div>
            <p className="text-sm font-bold text-slate-900">
              {timing.startTime.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })}
            </p>
          </div>
        )}

        {timing.endTime && (
          <div className="group relative bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-sky-200/50 shadow-sm hover:shadow-md transition-all hover:border-sky-300">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1 bg-sky-100 rounded-lg">
                <CheckCircle2 className="text-slate-600" size={14} />
              </div>
              <span className="text-xs font-bold text-sky-700 uppercase tracking-wide">
                End Time
              </span>
            </div>
            <p className="text-sm font-bold text-slate-900">
              {timing.endTime.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })}
            </p>
          </div>
        )}

        {timing.estimatedCompletion && (
          <div className="group relative bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-amber-200/50 shadow-sm hover:shadow-md transition-all hover:border-amber-300">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1 bg-amber-100 rounded-lg">
                <Activity
                  className={`text-amber-600 ${isActive ? "animate-pulse" : ""}`}
                  size={14}
                />
              </div>
              <span className="text-xs font-bold text-amber-700 uppercase tracking-wide">
                {isActive ? "Est. Completion" : "Was Est. At"}
              </span>
            </div>
            <p className="text-sm font-bold text-slate-900">
              {timing.estimatedCompletion.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const TabButton = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`group relative flex flex-shrink-0 items-center gap-2 px-4 sm:px-6 py-3 text-sm font-semibold whitespace-nowrap transition-all
      ${active ? "text-sky-700" : "text-slate-600 hover:text-slate-600"}`}
  >
    <span
      className={`transition-transform ${active ? "scale-110" : "group-hover:scale-105"}`}
    >
      {icon}
    </span>
    <span>{label}</span>
    {active && (
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-600 to-blue-600 rounded-t-full"></div>
    )}
  </button>
);

const getCampaignLabel = (campaign) => {
  if (campaign.status === "sending") return "Sending";
  if (campaign.status === "stopped") return "Stopped";
  if (
    campaign.status === "completed" ||
    campaign.status === "completed_with_errors"
  )
    return "Completed";
  if (campaign.status === "scheduled") return "Scheduled";
  if (campaign.sendType === "immediate") return "Immediate";
  return "Draft";
};

const STATUS_CONFIG = {
  sending: {
    bg: "bg-gradient-to-br from-blue-50 to-indigo-50",
    text: "text-blue-700",
    border: "border-blue-200",
    icon: <Activity size={14} className="animate-pulse" />,
  },
  stopped: {
    bg: "bg-gradient-to-br from-red-50 to-orange-50",
    text: "text-red-700",
    border: "border-red-200",
    icon: <StopCircle size={14} />,
  },
  scheduled: {
    bg: "bg-gradient-to-br from-indigo-50 to-purple-50",
    text: "text-indigo-700",
    border: "border-indigo-200",
    icon: <Calendar size={14} />,
  },
  completed: {
    bg: "bg-gradient-to-br from-sky-50 to-blue-50",
    text: "text-sky-700",
    border: "border-sky-200",
    icon: <TrendingUp size={14} />,
  },
  completed_with_errors: {
    bg: "bg-gradient-to-br from-amber-50 to-orange-50",
    text: "text-amber-700",
    border: "border-amber-200",
    icon: <TrendingUp size={14} />,
  },
  draft: {
    bg: "bg-gradient-to-br from-slate-50 to-gray-50",
    text: "text-sky-600",
    border: "border-slate-200",
    icon: <Mail size={14} />,
  },
};

// Shared per-campaign derived values, used by both the desktop table row
// and the mobile card so the two views never drift out of sync.
const getCampaignMeta = (campaign) => {
  const isScheduled = campaign.status === "scheduled";
  const isCompleted = campaign.status === "completed";
  const isSending = campaign.status === "sending";

  const type =
    campaign.sendType === "followup"
      ? "Follow-up"
      : isScheduled
        ? "Scheduled"
        : isCompleted
          ? "Completed"
          : isSending
            ? "Sending"
            : "Draft";

  const date =
    isScheduled && campaign.scheduledAt
      ? (() => {
          const d = new Date(campaign.scheduledAt);
          const datePart = d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          const timePart = d.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
          return `${datePart} at ${timePart}`;
        })()
      : campaign.createdAt
        ? new Date(campaign.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "—";

  const config = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.draft;
  const label = getCampaignLabel(campaign);

  const labelClasses =
    label === "Immediate" || label === "Scheduled"
      ? "bg-gradient-to-br from-indigo-50 to-purple-50 text-indigo-700 border-indigo-200"
      : label === "Sending"
        ? "bg-gradient-to-br from-blue-50 to-indigo-50 text-blue-700 border-blue-200"
        : label === "Stopped"
          ? "bg-gradient-to-br from-red-50 to-orange-50 text-red-700 border-red-200"
          : "bg-gradient-to-br from-sky-50 to-blue-50 text-sky-700 border-sky-200";

  return { type, date, config, label, labelClasses };
};

const DashboardTab = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [filter, setFilter] = useState("all");
  const [customDate, setCustomDate] = useState("");
  const [search, setSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [resending, setResending] = useState(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);

  // ✅ PERF FIX: fetchCampaigns takes explicit args to avoid stale closure bug.
  // The interval callback previously captured the initial filter/customDate values
  // and never updated when the user changed filters, causing stale data on auto-refresh.
  const fetchCampaigns = async (currentFilter, currentDate, isInitial) => {
    const f = currentFilter !== undefined ? currentFilter : filter;
    const d = currentDate !== undefined ? currentDate : customDate;
    try {
      if (!isInitial) setIsRefreshing(true);
      const params = new URLSearchParams();
      if (f) params.append("range", f);
      if (d) params.append("date", d);

      const res = await api.get(
        `${API_BASE_URL}/api/campaigns/dashboard?${params.toString()}`,
      );

      if (res.data.success) {
        setCampaigns(res.data.data?.recentCampaigns || []);
        setStats(res.data.data?.stats || {});
      }
    } catch (err) {
      console.error("Error fetching campaigns:", err);
      setError(err.response?.data?.message || "Failed to load campaigns");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // Pass filter/date explicitly so the 30s interval never uses stale closure values
    fetchCampaigns(filter, customDate, true);
    return startVisiblePolling(() => fetchCampaigns(filter, customDate), 30000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, customDate]);

  const toggleRow = (id) => {
    const newSet = new Set(expandedRows);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedRows(newSet);
  };

  const handleDelete = async (campaignId) => {
    if (
      !window.confirm(
        "Are you sure you want to delete this campaign? This action cannot be undone.",
      )
    ) {
      return;
    }

    try {
      setDeleting(campaignId);
      const res = await api.delete(
        `${API_BASE_URL}/api/campaigns/${campaignId}`,
      );

      if (res.data.success) {
        // ✅ PERF FIX: Update local state directly — no need for a second full API call
        setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
      }
    } catch (err) {
      console.error("Error deleting campaign:", err);
      alert(err.response?.data?.message || "Failed to delete campaign");
    } finally {
      setDeleting(null);
    }
  };

  const stopCampaign = async (id) => {
    try {
      const confirmStop = window.confirm(
        "Are you sure you want to stop this campaign?",
      );
      if (!confirmStop) return;

      const res = await api.post(`${API_BASE_URL}/api/campaigns/${id}/stop`);

      if (res.data.success) {
        alert("Campaign stopped successfully!");
        fetchCampaigns(filter, customDate);
      } else {
        alert(res.data.message || "Failed to stop campaign");
      }
    } catch (error) {
      console.error("Stop campaign error:", error);
      alert(error.response?.data?.message || "Network or server error");
    }
  };

  // Resumes a paused ("stopped") campaign from where it left off — the
  // backend only ever re-selects "pending" recipients, so completed sends
  // are never repeated.
  const resendCampaign = async (id) => {
    try {
      const confirmResend = window.confirm(
        "Resend this campaign? It will pick up exactly where it left off — recipients who already received it won't be emailed again.",
      );
      if (!confirmResend) return;

      setResending(id);
      const res = await api.post(`${API_BASE_URL}/api/campaigns/${id}/resend`);

      if (res.data.success) {
        alert(res.data.message || "Campaign resumed successfully!");
        fetchCampaigns(filter, customDate);
      } else {
        alert(res.data.message || "Failed to resend campaign");
      }
    } catch (error) {
      console.error("Resend campaign error:", error);
      alert(error.response?.data?.message || "Network or server error");
    } finally {
      setResending(null);
    }
  };

  const manualRefresh = async () => {
    await fetchCampaigns(filter, customDate);
  };

  if (loading) {
    // ✅ PERF FIX: Show skeleton UI immediately instead of blocking spinner.
    // Page feels instant — data fills in as it loads.
    return (
      <div className="space-y-6 animate-pulse">
        {/* Skeleton stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-white/70 rounded-2xl p-4 sm:p-6 border border-sky-100 h-28 sm:h-32"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-sky-100 rounded-xl mb-3 sm:mb-4" />
              <div className="h-3 bg-sky-100 rounded w-3/4 mb-2" />
              <div className="h-6 bg-sky-100 rounded w-1/2" />
            </div>
          ))}
        </div>
        {/* Skeleton table rows */}
        <div className="bg-white/70 rounded-2xl border border-sky-100 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="flex gap-4 px-6 py-4 border-b border-sky-50"
            >
              <div className="h-4 bg-sky-100 rounded flex-1" />
              <div className="h-4 bg-sky-100 rounded w-20" />
              <div className="h-4 bg-sky-100 rounded w-24" />
              <div className="h-4 bg-sky-100 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center bg-white/80 backdrop-blur-sm rounded-2xl p-8 border border-red-200 shadow-lg">
          <p className="text-red-600 mb-4 font-semibold">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-xl hover:shadow-lg transition-all font-semibold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const filteredCampaigns = campaigns.filter((campaign) =>
    campaign.name?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      {/* Enhanced Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
        <StatCard
          icon={<Send size={24} />}
          label="Total Campaigns"
          value={stats.totalCampaigns || 0}
          iconBg="bg-gradient-to-br from-sky-100 to-blue-100"
          iconColor="text-slate-600"
          accentColor="sky"
        />
        <StatCard
          icon={<Users size={24} />}
          label="Total Recipients"
          value={(stats.totalRecipients || 0).toLocaleString()}
          iconBg="bg-gradient-to-br from-blue-100 to-sky-100"
          iconColor="text-blue-600"
          accentColor="blue"
        />
        <StatCard
          icon={<Target size={24} />}
          label="Follow-up Campaigns"
          value={stats.totalFollowups || 0}
          iconBg="bg-gradient-to-br from-blue-100 to-cyan-100"
          iconColor="text-blue-600"
          accentColor="blue"
        />
        <StatCard
          icon={<Award size={24} />}
          label="Follow-up Emails"
          value={(stats.followupEmails || 0).toLocaleString()}
          iconBg="bg-gradient-to-br from-cyan-100 to-blue-100"
          iconColor="text-cyan-600"
          accentColor="cyan"
        />
      </div>

      {/* Enhanced Filters & Search */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 sm:p-6 border border-sky-200/50 shadow-sm mb-6 sm:mb-8">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          {/* Filter Buttons */}
          <div className="flex gap-2 flex-wrap w-full lg:w-auto">
            {["all", "today", "week", "month"].map((f) => (
              <button
                key={f}
                onClick={() => {
                  setFilter(f);
                  setCustomDate("");
                }}
                className={`relative px-4 sm:px-5 py-2.5 rounded-xl text-sm font-bold transition-all transform hover:scale-105 ${
                  filter === f && !customDate
                    ? "bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-lg shadow-sky-500/30"
                    : "bg-gradient-to-r from-sky-50 to-blue-50 text-sky-700 hover:from-sky-100 hover:to-blue-100 border border-sky-200"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}

            {/* Date Picker */}
            <div className="relative">
              <Calendar
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2
                          text-sky-600 opacity-80
                          pointer-events-none"
              />

              <input
                type="date"
                value={customDate}
                onChange={(e) => {
                  setCustomDate(e.target.value);
                  setFilter("");
                }}
                className="pl-10 pr-3 py-2.5
                          border-2 border-sky-400
                          rounded-xl
                          text-sm font-semibold
                          bg-white
                          text-slate-800
                          placeholder-slate-400
                          focus:outline-none
                          focus:ring-2 focus:ring-sky-400/40
                          focus:border-sky-500
                          transition-colors
                          w-full sm:w-auto"
              />
            </div>
          </div>

          {/* Search & Refresh */}
          <div className="flex gap-3 items-center w-full lg:w-auto">
            <div className="relative w-full lg:w-72">
              <Search
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 
                        text-sky-600 opacity-70 
                        pointer-events-none"
              />

              <input
                type="text"
                placeholder="Search campaigns..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-11 pr-4 py-3
                        rounded-xl
                        border-2 border-sky-500
                        text-sm font-semibold
                        bg-white
                        text-slate-800
                        placeholder-sky-400
                        focus:outline-none
                        focus:ring-2 focus:ring-sky-400/40"
              />
            </div>

            <button
              onClick={manualRefresh}
              disabled={isRefreshing}
              className="flex-shrink-0 p-2.5 bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-xl hover:shadow-lg shadow-sky-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105"
              title="Refresh campaigns"
            >
              <RefreshCw
                size={20}
                className={isRefreshing ? "animate-spin" : ""}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Campaigns List */}
      {campaigns.length === 0 ? (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-sky-200/50 shadow-lg text-center py-24">
          <div className="relative inline-block mb-6">
            <div className="absolute inset-0 bg-sky-200 rounded-full blur-2xl opacity-30"></div>
            <Mail className="relative mx-auto text-sky-300" size={64} />
          </div>
          <p className="text-sky-600 text-xl font-bold mb-2">
            No campaigns found
          </p>
          <p className="text-slate-600 text-sm">
            Create your first campaign to get started
          </p>
        </div>
      ) : (
        <>
          {/* ── Desktop table (md and up) ─────────────────────────── */}
          <div className="hidden md:block bg-white/80 backdrop-blur-sm rounded-2xl border border-sky-200/50 shadow-lg overflow-hidden">
            <div className="overflow-auto min-h-[600px] max-h-[650px]">
              <table className="w-full min-w-[860px]">
                <thead className="sticky top-0 bg-gradient-to-r from-sky-50 via-blue-50 to-blue-50 z-10">
                  <tr className="border-b border-sky-200">
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">
                        Campaign
                      </span>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">
                        Type
                      </span>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">
                        Recipients
                      </span>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">
                        Date
                      </span>
                    </th>
                    <th className="px-6 py-4 text-center">
                      <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">
                        Actions
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sky-100 bg-white">
                  {filteredCampaigns.map((campaign) => {
                    const { date, config, label, labelClasses } =
                      getCampaignMeta(campaign);
                    const isExpanded = expandedRows.has(campaign.id);

                    return (
                      <Fragment key={campaign.id}>
                        <tr className="hover:bg-sky-50/50 transition-all group">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div
                                className={`relative w-11 h-11 rounded-xl ${config.bg} flex items-center justify-center flex-shrink-0 border ${config.border} shadow-sm group-hover:scale-105 transition-transform`}
                              >
                                <Mail className={config.text} size={20} />
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-bold text-slate-900 text-sm truncate">
                                  {campaign.name?.replace(/\s*\(\d+\)\s*$/, "")}
                                </h3>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold text-xs shadow-sm whitespace-nowrap ${labelClasses}`}
                            >
                              {label}
                            </span>
                          </td>

                          <td className="px-6 py-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-2">
                                <div className="p-1 bg-sky-100 rounded-lg">
                                  <Users size={16} className="text-slate-600" />
                                </div>
                                <span className="text-sm font-bold text-slate-900">
                                  {(
                                    campaign.recipientCount ?? 0
                                  ).toLocaleString()}
                                </span>
                                <span className="text-xs text-slate-600 font-medium">
                                  recipients
                                </span>
                              </div>

                              {campaign.repliedCount > 0 && (
                                <span
                                  className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold"
                                  title={`${campaign.repliedCount} replied (${campaign.replyRate}% of sent)`}
                                >
                                  {campaign.repliedCount} replied
                                </span>
                              )}
                              {(campaign.bouncedCount > 0 ||
                                campaign.unsubscribedCount > 0) && (
                                <span
                                  className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold"
                                  title={`${campaign.bouncedCount || 0} bounced, ${campaign.unsubscribedCount || 0} unsubscribed, ${campaign.skippedCount || 0} skipped`}
                                >
                                  {(campaign.bouncedCount || 0) +
                                    (campaign.unsubscribedCount || 0)}{" "}
                                  opted out / bounced
                                </span>
                              )}

                              <button
                                onClick={() =>
                                  setSelectedCampaignId(campaign.id)
                                }
                                className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline ml-1"
                              >
                                View
                              </button>
                            </div>
                          </td>

                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <Calendar size={16} className="text-slate-600" />
                              <span className="text-sm text-slate-700 font-medium">
                                {date}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex flex-wrap gap-2 justify-center">
                              {(campaign.status === "sending" ||
                                campaign.status === "completed" ||
                                campaign.status ===
                                  "completed_with_errors") && (
                                <button
                                  onClick={() => toggleRow(campaign.id)}
                                  className="inline-flex items-center gap-1 px-3 py-2 bg-gradient-to-r from-sky-100 to-blue-100 hover:from-sky-200 hover:to-blue-200 text-sky-700 rounded-xl transition-all text-xs font-bold border border-sky-200 shadow-sm transform hover:scale-105"
                                >
                                  {isExpanded ? (
                                    <>
                                      <ChevronUp size={14} />
                                      Hide
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown size={14} />
                                      Details
                                    </>
                                  )}
                                </button>
                              )}

                              <button
                                onClick={() => handleDelete(campaign.id)}
                                disabled={deleting === campaign.id}
                                className="px-3 py-2 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl text-xs hover:shadow-lg shadow-red-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 font-bold transform hover:scale-105"
                              >
                                {deleting === campaign.id ? (
                                  <>
                                    <Loader2
                                      size={12}
                                      className="animate-spin"
                                    />
                                    Deleting...
                                  </>
                                ) : (
                                  "Delete"
                                )}
                              </button>

                              {/* 🔥 PAUSE BUTTON — stops the send immediately;
                              already-sent recipients are untouched and the
                              rest stay "pending" for Resend to pick up. */}
                              {campaign.status === "sending" && (
                                <button
                                  onClick={() => stopCampaign(campaign.id)}
                                  className="inline-flex items-center gap-1 px-3 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl text-xs hover:shadow-lg shadow-orange-500/30 transition-all font-bold transform hover:scale-105"
                                >
                                  <PauseCircle size={14} />
                                  Pause
                                </button>
                              )}

                              {/* 🔄 RESEND BUTTON — resumes a paused campaign
                              from where it stopped, no duplicate sends. */}
                              {campaign.status === "stopped" && (
                                <button
                                  onClick={() => resendCampaign(campaign.id)}
                                  disabled={resending === campaign.id}
                                  className="inline-flex items-center gap-1 px-3 py-2 bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-xl text-xs hover:shadow-lg shadow-sky-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-bold transform hover:scale-105"
                                >
                                  {resending === campaign.id ? (
                                    <>
                                      <Loader2
                                        size={12}
                                        className="animate-spin"
                                      />
                                      Resending...
                                    </>
                                  ) : (
                                    <>
                                      <RotateCcw size={14} />
                                      Resend
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded &&
                          (campaign.status === "sending" ||
                            campaign.status === "completed" ||
                            campaign.status === "completed_with_errors") && (
                            <tr>
                              <td
                                colSpan={5}
                                className="px-6 py-0 bg-gradient-to-br from-sky-50/30 via-blue-50/30 to-blue-50/30"
                              >
                                <div className="py-5 space-y-4">
                                  <CampaignTiming campaign={campaign} />
                                  {campaign.status === "sending" && (
                                    <CampaignProgress
                                      campaignId={campaign.id}
                                    />
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Mobile card list (below md) ───────────────────────── */}
          <div className="md:hidden space-y-3">
            {filteredCampaigns.map((campaign) => {
              const { date, config, label, labelClasses } =
                getCampaignMeta(campaign);
              const isExpanded = expandedRows.has(campaign.id);

              return (
                <div
                  key={campaign.id}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl border border-sky-200/50 shadow-sm p-4"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`relative w-10 h-10 rounded-xl ${config.bg} flex items-center justify-center flex-shrink-0 border ${config.border} shadow-sm`}
                    >
                      <Mail className={config.text} size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-slate-900 text-sm truncate">
                        {campaign.name?.replace(/\s*\(\d+\)\s*$/, "")}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg border font-bold text-[11px] whitespace-nowrap ${labelClasses}`}
                        >
                          {label}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-slate-600">
                          <Calendar size={12} />
                          {date}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center flex-wrap gap-2 mt-3">
                    <div className="flex items-center gap-1.5 bg-sky-50 border border-sky-100 rounded-lg px-2.5 py-1.5">
                      <Users size={13} className="text-slate-600" />
                      <span className="text-xs font-bold text-slate-900">
                        {(campaign.recipientCount ?? 0).toLocaleString()}
                      </span>
                      <span className="text-[11px] text-slate-600">
                        recipients
                      </span>
                    </div>
                    {campaign.repliedCount > 0 && (
                      <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold">
                        {campaign.repliedCount} replied
                      </span>
                    )}
                    {(campaign.bouncedCount > 0 ||
                      campaign.unsubscribedCount > 0) && (
                      <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold">
                        {(campaign.bouncedCount || 0) +
                          (campaign.unsubscribedCount || 0)}{" "}
                        opted out
                      </span>
                    )}
                    <button
                      onClick={() => setSelectedCampaignId(campaign.id)}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline ml-auto"
                    >
                      View
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-sky-100">
                    {(campaign.status === "sending" ||
                      campaign.status === "completed" ||
                      campaign.status === "completed_with_errors") && (
                      <button
                        onClick={() => toggleRow(campaign.id)}
                        className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 bg-gradient-to-r from-sky-100 to-blue-100 text-sky-700 rounded-xl transition-all text-xs font-bold border border-sky-200"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp size={14} />
                            Hide details
                          </>
                        ) : (
                          <>
                            <ChevronDown size={14} />
                            Details
                          </>
                        )}
                      </button>
                    )}

                    {campaign.status === "sending" && (
                      <button
                        onClick={() => stopCampaign(campaign.id)}
                        className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl text-xs font-bold"
                      >
                        <PauseCircle size={14} />
                        Pause
                      </button>
                    )}

                    {campaign.status === "stopped" && (
                      <button
                        onClick={() => resendCampaign(campaign.id)}
                        disabled={resending === campaign.id}
                        className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-xl text-xs font-bold disabled:opacity-50"
                      >
                        {resending === campaign.id ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            Resending...
                          </>
                        ) : (
                          <>
                            <RotateCcw size={14} />
                            Resend
                          </>
                        )}
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(campaign.id)}
                      disabled={deleting === campaign.id}
                      className="px-3 py-2 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {deleting === campaign.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        "Delete"
                      )}
                    </button>
                  </div>

                  {isExpanded &&
                    (campaign.status === "sending" ||
                      campaign.status === "completed" ||
                      campaign.status === "completed_with_errors") && (
                      <div className="mt-3 space-y-3">
                        <CampaignTiming campaign={campaign} />
                        {campaign.status === "sending" && (
                          <CampaignProgress campaignId={campaign.id} />
                        )}
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {selectedCampaignId && (
        <CampaignView
          campaignId={selectedCampaignId}
          onClose={() => setSelectedCampaignId(null)}
        />
      )}
    </div>
  );
};

const StatCard = ({ icon, label, value, iconBg, iconColor, accentColor }) => (
  <div className="group relative">
    <div
      className={`absolute inset-0 bg-${accentColor}-200/30 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
    ></div>
    <div className="relative bg-white/80 backdrop-blur-sm rounded-2xl p-4 sm:p-6 border border-sky-200/50 hover:border-sky-300/70 transition-all shadow-sm hover:shadow-lg transform hover:scale-105 duration-300">
      <div className="flex items-start justify-between mb-3 sm:mb-5">
        <div
          className={`relative w-11 h-11 sm:w-14 sm:h-14 ${iconBg} rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-300`}
        >
          <div className={iconColor}>{icon}</div>
        </div>
      </div>
      <div>
        <p className="text-[13px] sm:text-[16px] font-bold text-sky-600 mb-1 sm:mb-2 tracking-wide">
          {label}
        </p>
        <p className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight">
          {value}
        </p>
      </div>
    </div>
  </div>
);
