// client/src/pages/campaigns/CampaignList.jsx
import { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard,
  Send,
  UserPlus,
  Users,
  TrendingUp,
  Mail, 
  Calendar,
  Activity,
  BarChart3,
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
  RotateCcw
} from "lucide-react";
import CreateCampaign from "./campaignPages/CreateCampaign";
import CampaignDetail from "./campaignPages/CampaignDetail";
import CampaignView from "./campaignPages/Schedulemodal";
import DailyLimitBanner from "./campaignPages/DailyLimitBanner";

import { api } from "../utils/api";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function CampaignList() {
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-green-50 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-200/20 rounded-full blur-3xl animate-pulse" style={{animationDuration: '4s'}}></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-teal-200/20 rounded-full blur-3xl animate-pulse" style={{animationDuration: '6s', animationDelay: '1s'}}></div>
      </div>

      {/* Modern Header with Glass Effect */}
      <div className="bg-green/20 backdrop-blur-xl border-b border-emerald-200/50 sticky top-0 z-100 shadow-sm">
        <div className="max-w-8xl mx-auto px-6">
          <div className="flex items-center justify-between py-5">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl blur opacity-50"></div>
                <div className="relative w-12 h-12 bg-gradient-to-br from-emerald-600 to-green-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/30 transform transition-all hover:scale-110 hover:rotate-3">
                  <Mail className="text-white" size={22} />
                </div>
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
                  Campaign Manager
                </h1>
                <p className="text-xs text-slate-600 font-medium mt-0.5">Manage & optimize your email campaigns</p>
              </div>
            </div>
            
            {/* Quick Stats Badge */}
            <div className="hidden md:flex items-center gap-3 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-1 rounded-xl border border-emerald-200/50">
              <div className="flex items-center gap-1.5">
                <Zap className="text-slate-600" size={16} />
                <span className="text-xs font-semibold text-emerald-700">Active</span>
              </div>
              <div className="w-px h-4 bg-emerald-200"></div>
              
              <DailyLimitBanner />
            </div>
          </div>
       
          
          {/* Enhanced Tab Navigation */}
          <div className="flex gap-2 -mb-px">
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
      <div className="max-w-8xl mx-auto px-6 py-8 relative z-10">
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
    const i = setInterval(fetchProgress, 5000);
    return () => clearInterval(i);
  }, [campaignId]);

  const fetchProgress = async () => {
    try {
      const res = await api.get(`${API_BASE_URL}/api/campaigns/${campaignId}/progress`);
      if (res.data.success) setRows(res.data.data);
    } catch (error) {
      console.error("Failed to fetch progress:", error);
    }
  };

  return (
    <div className="mt-4 bg-gradient-to-br from-emerald-50 via-teal-50 to-green-50 rounded-2xl p-5 border border-emerald-200/50 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 bg-emerald-100 rounded-lg">
          <Activity className="text-slate-600" size={16} />
        </div>
        <h4 className="text-sm font-bold text-emerald-900">Live Progress Tracking</h4>
        <span className="ml-auto text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-medium">Real-time</span>
      </div>
      <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-emerald-100 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100">
              <th className="px-4 py-3.5 text-left text-xs font-bold text-emerald-600 uppercase tracking-wide">Email</th>
              <th className="px-4 py-3.5 text-left text-xs font-bold text-emerald-600 uppercase tracking-wide">Domain</th>
              <th className="px-4 py-3.5 text-left text-xs font-bold text-emerald-600 uppercase tracking-wide">Processing</th>
              <th className="px-4 py-3.5 text-left text-xs font-bold text-emerald-600 uppercase tracking-wide">Completed</th>
              <th className="px-4 py-3.5 text-left text-xs font-bold text-emerald-600 uppercase tracking-wide">Sending IP</th>
              <th className="px-4 py-3.5 text-left text-xs font-bold text-emerald-600 uppercase tracking-wide">ETA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-emerald-100">
            {rows.map(r => (
              <tr key={r.email} className="hover:bg-emerald-50/50 transition-colors">
                <td className="px-4 py-3.5 text-slate-800 font-medium">{r.email}</td>
                <td className="px-4 py-3.5 text-slate-600">{r.domain}</td>
                <td className="px-4 py-3.5">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                    {r.processing}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
                    {r.completed}
                  </span>
                </td>
                <td>{r.sendingIp || "—"}</td>
                <td className="px-4 py-3.5">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-100 text-purple-700 text-xs font-semibold border border-purple-200">
                    <Clock size={12} />
                    {r.processing > 0
                        ? `Sending  • ETA ${r.eta}`
                        : `Completed`}
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
    const isCompleted = campaign.status === "completed" || campaign.status === "completed_with_errors";
    if (!isActive && !isCompleted) {
      return { startTime: null, endTime: null, estimatedCompletion: null, duration: null };
    }

    // Use campaign.createdAt as start time — always available and never stale.
    const startTime = campaign.createdAt ? new Date(campaign.createdAt) : null;

    // End time: from recipients for completed campaigns
    const endTime = isCompleted && campaign.lastSentAt
      ? new Date(campaign.lastSentAt)
      : null;

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
    <div className="bg-gradient-to-br from-emerald-50 via-teal-50 to-green-50 rounded-2xl p-5 border border-emerald-200/50 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 bg-emerald-100 rounded-lg">
          <Clock className="text-slate-600" size={16} />
        </div>
        <h4 className="text-sm font-bold text-emerald-700">Campaign Timeline</h4>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {timing.startTime && (
          <div className="group relative bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-emerald-200/50 shadow-sm hover:shadow-md transition-all hover:border-emerald-300">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1 bg-emerald-100 rounded-lg">
                <Play className="text-slate-600" size={14} />
              </div>
              <span className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Start Time</span>
            </div>
            <p className="text-sm font-bold text-slate-900">
              {timing.startTime.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true
              })}
            </p>
          </div>
        )}
        
        {timing.endTime && (
          <div className="group relative bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-emerald-200/50 shadow-sm hover:shadow-md transition-all hover:border-emerald-300">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1 bg-emerald-100 rounded-lg">
                <CheckCircle2 className="text-slate-600" size={14} />
              </div>
              <span className="text-xs font-bold text-emerald-700 uppercase tracking-wide">End Time</span>
            </div>
            <p className="text-sm font-bold text-slate-900">
              {timing.endTime.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true
              })}
            </p>
          </div>
        )}
        
        {timing.estimatedCompletion && (
          <div className="group relative bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-amber-200/50 shadow-sm hover:shadow-md transition-all hover:border-amber-300">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1 bg-amber-100 rounded-lg">
                <Activity className={`text-amber-600 ${isActive ? "animate-pulse" : ""}`} size={14} />
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
                hour12: true
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
    className={`group relative flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-all
      ${
        active
          ? "text-emerald-700"
          : "text-slate-600 hover:text-slate-600"
      }`}
  >
    <span className={`transition-transform ${active ? 'scale-110' : 'group-hover:scale-105'}`}>
      {icon}
    </span>
    <span>{label}</span>
    {active && (
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-600 to-green-600 rounded-t-full"></div>
    )}
  </button>
);

const getCampaignLabel = (campaign) => {
  if (campaign.status === "sending") return "Sending";
  if (campaign.status === "stopped") return "Stopped";
  if (campaign.status === "completed" || campaign.status === "completed_with_errors") return "Completed";
  if (campaign.status === "scheduled") return "Scheduled";
  if (campaign.sendType === "immediate") return "Immediate";
  return "Draft";
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

      const res = await api.get(`${API_BASE_URL}/api/campaigns/dashboard?${params.toString()}`);

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
    const interval = setInterval(() => fetchCampaigns(filter, customDate), 30000);
    return () => clearInterval(interval);
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
    if (!window.confirm("Are you sure you want to delete this campaign? This action cannot be undone.")) {
      return;
    }

    try {
      setDeleting(campaignId);
      const res = await api.delete(`${API_BASE_URL}/api/campaigns/${campaignId}`);
      
      if (res.data.success) {
        // ✅ PERF FIX: Update local state directly — no need for a second full API call
        setCampaigns(prev => prev.filter(c => c.id !== campaignId));
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
      "Are you sure you want to stop this campaign?"
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
      "Resend this campaign? It will pick up exactly where it left off — recipients who already received it won't be emailed again."
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white/70 rounded-2xl p-6 border border-emerald-100 h-32">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl mb-4" />
              <div className="h-3 bg-emerald-100 rounded w-3/4 mb-2" />
              <div className="h-6 bg-emerald-100 rounded w-1/2" />
            </div>
          ))}
        </div>
        {/* Skeleton table rows */}
        <div className="bg-white/70 rounded-2xl border border-emerald-100 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-4 px-6 py-4 border-b border-emerald-50">
              <div className="h-4 bg-emerald-100 rounded flex-1" />
              <div className="h-4 bg-emerald-100 rounded w-20" />
              <div className="h-4 bg-emerald-100 rounded w-24" />
              <div className="h-4 bg-emerald-100 rounded w-16" />
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
            onClick={manualRefresh}
            className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-xl hover:shadow-lg transition-all font-semibold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div>
      {/* Enhanced Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          icon={<Send size={26} />}
          label="Total Campaigns"
          value={stats.totalCampaigns || 0}
          iconBg="bg-gradient-to-br from-emerald-100 to-green-100"
          iconColor="text-slate-600"
          accentColor="emerald"
        />
        <StatCard
          icon={<Users size={26} />}
          label="Total Recipients"
          value={(stats.totalRecipients || 0).toLocaleString()}
          iconBg="bg-gradient-to-br from-green-100 to-emerald-100"
          iconColor="text-green-600"
          accentColor="green"
        />
        <StatCard
          icon={<Target size={26} />}
          label="Follow-up Campaigns"
          value={stats.totalFollowups || 0}
          iconBg="bg-gradient-to-br from-teal-100 to-cyan-100"
          iconColor="text-teal-600"
          accentColor="teal"
        />
        <StatCard
          icon={<Award size={26} />}
          label="Follow-up Emails"
          value={(stats.followupEmails || 0).toLocaleString()}
          iconBg="bg-gradient-to-br from-cyan-100 to-blue-100"
          iconColor="text-cyan-600"
          accentColor="cyan"
        />
      </div>

      {/* Enhanced Filters & Search */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-emerald-200/50 shadow-sm mb-8">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          {/* Filter Buttons */}
          <div className="flex gap-2 flex-wrap">
            {["all", "today", "week", "month"].map((f) => (
              <button
                key={f}
                onClick={() => {
                  setFilter(f);
                  setCustomDate("");
                }}
                className={`relative px-5 py-2.5 rounded-xl text-sm font-bold transition-all transform hover:scale-105 ${
                  filter === f && !customDate
                    ? "bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-lg shadow-emerald-500/30"
                    : "bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-700 hover:from-emerald-100 hover:to-teal-100 border border-emerald-200"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            
 
            {/* Date Picker */}
            <div className="relative">
              {/* Custom Calendar Icon */}
              <Calendar
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2
                          text-emerald-600 opacity-80
                          pointer-events-none"
              />

              <input
                type="date"
                value={customDate}
                onChange={(e) => {
                  setCustomDate(e.target.value);
                  setFilter("");
                }}
                className="pl-10 pr-4 py-2.5
                          border-2 border-emerald-400
                          rounded-xl
                          text-sm font-semibold
                          bg-white
                          text-slate-800
                          placeholder-slate-400
                          focus:outline-none
                          focus:ring-2 focus:ring-emerald-400/40
                          focus:border-emerald-500
                          transition-colors"
              />
            </div>

          </div>

          {/* Search & Refresh */}
          <div className="flex gap-3 items-center w-full lg:w-auto">
          <div className="relative w-full lg:w-72">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 
                        text-emerald-600 opacity-70 
                        pointer-events-none"
            />

            <input
              type="text"
              placeholder="Search campaigns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3
                        rounded-xl
                        border-2 border-emerald-500
                        text-sm font-semibold
                        bg-white
                        text-slate-800
                        placeholder-emerald-400
                        focus:outline-none
                        focus:ring-2 focus:ring-emerald-400/40"
            />
          </div>

            <button
              onClick={manualRefresh}
              disabled={isRefreshing}
              className="p-2.5 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-xl hover:shadow-lg shadow-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105"
              title="Refresh campaigns"
            >
              <RefreshCw size={20} className={isRefreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Enhanced Campaigns Table */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-emerald-200/50 shadow-lg overflow-hidden min-h-[600px]">
        {campaigns.length === 0 ? (
          <div className="text-center py-24">
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 bg-emerald-200 rounded-full blur-2xl opacity-30"></div>
              <Mail className="relative mx-auto text-emerald-300" size={64} />
            </div>
            <p className="text-emerald-600 text-xl font-bold mb-2">No campaigns found</p>
            <p className="text-slate-600 text-sm">Create your first campaign to get started</p>
          </div>
        ) : (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-emerald-200/50 shadow-lg overflow-hidden">
            <div className="overflow-auto min-h-[600px] max-h-[650px]">
              <table className="w-full">
                <thead className="sticky top-0 bg-gradient-to-r from-emerald-50 via-teal-50 to-green-50 z-10">
                  <tr className="border-b border-emerald-200">
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Campaign</span>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Type</span>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Recipients</span>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Date</span>
                    </th>
                
                    <th className="px-6 py-4 text-center">
                      <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-100 bg-white">
                  {campaigns
                  .filter(campaign =>
                    campaign.name?.toLowerCase().includes(search.toLowerCase())
                  )
                  .map((campaign) => {
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

                  const date = isScheduled && campaign.scheduledAt
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

                  const isExpanded = expandedRows.has(campaign.id);

                  const statusConfig = {
                    sending: {
                      bg: "bg-gradient-to-br from-blue-50 to-indigo-50",
                      text: "text-blue-700",
                      border: "border-blue-200",
                      icon: <Activity size={14} className="animate-pulse" />
                    },
                    stopped: {
                      bg: "bg-gradient-to-br from-red-50 to-orange-50",
                      text: "text-red-700",
                      border: "border-red-200",
                      icon: <StopCircle size={14} />
                    },
                    scheduled: {
                      bg: "bg-gradient-to-br from-indigo-50 to-purple-50",
                      text: "text-indigo-700",
                      border: "border-indigo-200",
                      icon: <Calendar size={14} />
                    },
                    completed: {
                      bg: "bg-gradient-to-br from-emerald-50 to-teal-50",
                      text: "text-emerald-700",
                      border: "border-emerald-200",
                      icon: <TrendingUp size={14} />
                    },
                    completed_with_errors: {
                      bg: "bg-gradient-to-br from-amber-50 to-orange-50",
                      text: "text-amber-700",
                      border: "border-amber-200",
                      icon: <TrendingUp size={14} />
                    },
                    draft: {
                      bg: "bg-gradient-to-br from-slate-50 to-gray-50",
                      text: "text-emerald-600",
                      border: "border-slate-200",
                      icon: <Mail size={14} />
                    },
                  };

                  const config = statusConfig[campaign.status] || statusConfig.draft;

                  return (
                    <>
                      <tr key={campaign.id} className="hover:bg-emerald-50/50 transition-all group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`relative w-11 h-11 rounded-xl ${config.bg} flex items-center justify-center flex-shrink-0 border ${config.border} shadow-sm group-hover:scale-105 transition-transform`}>
                              <Mail className={config.text} size={20} />
                            </div>
                            <div>
                              <h3 className="font-bold text-slate-900 text-sm">
                                {campaign.name?.replace(/\s*\(\d+\)\s*$/, "")}
                              </h3>
                              {/* {campaign.fromNames?.length > 0 && (
                                <p className="text-xs text-slate-600 mt-0.5 font-medium">
                                  {campaign.fromNames.join(", ")}
                                </p>
                              )} */}
                            </div>
                          </div>
                        </td>
                       <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold text-xs shadow-sm
                              ${
                                getCampaignLabel(campaign) === "Immediate"
                                  ? "bg-gradient-to-br from-indigo-50 to-purple-50 text-indigo-700 border-indigo-200"
                                  : getCampaignLabel(campaign) === "Scheduled"
                                  ? "bg-gradient-to-br from-indigo-50 to-purple-50 text-indigo-700 border-indigo-200"
                                  : getCampaignLabel(campaign) === "Sending"
                                  ? "bg-gradient-to-br from-blue-50 to-indigo-50 text-blue-700 border-blue-200"
                                  : getCampaignLabel(campaign) === "Stopped"
                                  ? "bg-gradient-to-br from-red-50 to-orange-50 text-red-700 border-red-200"
                                  : "bg-gradient-to-br from-emerald-50 to-teal-50 text-emerald-700 border-emerald-200"
                              }
                            `}
                          >
                            {getCampaignLabel(campaign)}
                          </span>
                        </td>

                        <td className="px-6 py-1">
                          <div className="flex items-center">
                            
                            {/* Left Side - Icon + Count */}
                            <div className="flex items-center gap-2">
                              <div className="p-1 bg-emerald-100 rounded-lg">
                                <Users size={16} className="text-slate-600" />
                              </div>

                              <span className="text-sm font-bold text-slate-900">
                                {(campaign.recipientCount ?? 0).toLocaleString()}
                              </span>

                              <span className="text-xs text-slate-600 font-medium">
                                recipients
                              </span>
                            </div>

                            {/* Right Side - View Button */}
                            <button
                              onClick={() => setSelectedCampaignId(campaign.id)}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline ml-3"
                            >
                              View
                            </button>

                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Calendar size={16} className="text-slate-600" />
                            <span className="text-sm text-slate-700 font-medium">{date}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex gap-2 justify-center">

                            {(campaign.status === "sending" ||
                              campaign.status === "completed" ||
                              campaign.status === "completed_with_errors") && (
                              <button
                                onClick={() => toggleRow(campaign.id)}
                                className="inline-flex items-center gap-1 px-4 py-2 bg-gradient-to-r from-emerald-100 to-teal-100 hover:from-emerald-200 hover:to-teal-200 text-emerald-700 rounded-xl transition-all text-xs font-bold border border-emerald-200 shadow-sm transform hover:scale-105"
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
                              className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl text-xs hover:shadow-lg shadow-red-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 font-bold transform hover:scale-105"
                            >
                              {deleting === campaign.id ? (
                                <>
                                  <Loader2 size={12} className="animate-spin" />
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
                                className="inline-flex items-center gap-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl text-xs hover:shadow-lg shadow-orange-500/30 transition-all font-bold transform hover:scale-105"
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
                                className="inline-flex items-center gap-1 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-xs hover:shadow-lg shadow-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-bold transform hover:scale-105"
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

                          </div>
                        </td>

                      </tr>
                      {isExpanded && (campaign.status === "sending" || campaign.status === "completed" || campaign.status === "completed_with_errors") && (
                        <tr>
                          <td colSpan={5} className="px-6 py-0 bg-gradient-to-br from-emerald-50/30 via-teal-50/30 to-green-50/30">
                            <div className="py-5 space-y-4">
                              <CampaignTiming campaign={campaign} />
                              {campaign.status === "sending" && (
                                <CampaignProgress campaignId={campaign.id} />
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
                
              </tbody>
            </table>
            </div>
          </div>

        )}
        {selectedCampaignId && (
          <CampaignView
            campaignId={selectedCampaignId}
            onClose={() => setSelectedCampaignId(null)}
          />
        )}

      </div>
    </div>
  );
};

const StatCard = ({ icon, label, value, iconBg, iconColor, accentColor }) => (
  <div className="group relative">
    <div className={`absolute inset-0 bg-${accentColor}-200/30 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500`}></div>
    <div className="relative bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-emerald-200/50 hover:border-emerald-300/70 transition-all shadow-sm hover:shadow-lg transform hover:scale-105 duration-300">
      <div className="flex items-start justify-between mb-5">
        <div className={`relative w-14 h-14 ${iconBg} rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-300`}>
          <div className={iconColor}>{icon}</div>
        </div>
      </div>
      <div>
        <p className="text-[16px] font-bold text-emerald-600 mb-2 tracking-wide">{label}</p>
        <p className="text-3xl font-black text-slate-900 tracking-tight">{value}</p>
      </div>
    </div>
  </div>
);