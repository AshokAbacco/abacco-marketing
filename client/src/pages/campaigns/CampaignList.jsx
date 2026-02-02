// client/src/pages/campaigns/CampaignList.jsx
import { useState, useEffect } from "react";
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
  Loader2
} from "lucide-react";
import CreateCampaign from "./campaignPages/CreateCampaign";
import CampaignDetail from "./campaignPages/CampaignDetail";
import { api } from "../utils/api";

export default function CampaignList() {
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
      {/* Modern Header with Gradient */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Mail className="text-white" size={20} />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                  Campaign Manager
                </h1>
                <p className="text-xs text-slate-500">Manage your email campaigns</p>
              </div>
            </div>
          </div>
          
          {/* Tab Navigation */}
          <div className="flex gap-1 -mb-px">
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
      <div className="max-w-7xl mx-auto px-6 py-8">
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
    const i = setInterval(fetchProgress, 5000); // Update every 5 seconds
    return () => clearInterval(i);
  }, [campaignId]);

  const fetchProgress = async () => {
    try {
      const res = await api.get(`/api/campaigns/${campaignId}/progress`);
      if (res.data.success) setRows(res.data.data);
    } catch (error) {
      console.error("Failed to fetch progress:", error);
    }
  };

  return (
    <div className="mt-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="text-blue-600" size={16} />
        <h4 className="text-sm font-semibold text-slate-700">Live Progress</h4>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-slate-50 to-slate-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Email</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Domain</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Processing</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Completed</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">ETA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.email} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3 text-slate-700">{r.email}</td>
                <td className="px-4 py-3 text-slate-600">{r.domain}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                    {r.processing}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    {r.completed}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-100 text-purple-700 text-xs">
                    <Clock size={12} />
                    {r.eta}
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

// New component to show campaign timing
const CampaignTiming = ({ campaign }) => {
  const [timing, setTiming] = useState({
    startTime: null,
    endTime: null,
    estimatedCompletion: null,
    duration: null,
    isActive: false
  });

  useEffect(() => {
    calculateTiming();
  }, [campaign]);

const calculateTiming = async () => {
  if (campaign.status === "sending") {
    const firstSent = campaign.recipients?.find(r => r.sentAt);
    const startTime = firstSent?.sentAt ? new Date(firstSent.sentAt) : null;
    
    const pendingCount = campaign.recipients?.filter(r => r.status === "pending").length || 0;
    
    if (pendingCount > 0 && startTime) {
      try {
        const res = await api.get(`/api/campaigns/${campaign.id}/progress`);
        if (res.data.success) {
          const progressRows = res.data.data;
          
          let totalMinutes = 0;
          progressRows.forEach(row => {
            const eta = row.eta;
            if (eta.includes('h')) {
              const [hours, mins] = eta.split('h').map(s => parseInt(s.replace('m', '').trim()));
              totalMinutes += (hours || 0) * 60 + (mins || 0);
            } else {
              totalMinutes += parseInt(eta.replace('m', '')) || 0;
            }
          });

          const estimatedCompletion = new Date(Date.now() + totalMinutes * 60000);
          
          // ✅ ADD THIS: Calculate current duration for active campaigns
          const currentDuration = Math.ceil((Date.now() - startTime.getTime()) / 60000);
          
          setTiming({
            startTime,
            endTime: null,
            estimatedCompletion,
            duration: currentDuration, // ✅ Show current duration
            isActive: true
          });
        }
      } catch (error) {
        console.error("Failed to calculate timing:", error);
      }
    } else if (startTime) {
      // ✅ ADD THIS: For campaigns with no pending (but still sending)
      const currentDuration = Math.ceil((Date.now() - startTime.getTime()) / 60000);
      
      setTiming({
        startTime,
        endTime: null,
        estimatedCompletion: new Date(Date.now() + 5 * 60000),
        duration: currentDuration, // ✅ Show current duration
        isActive: true
      });
    }
  }};

  const formatTime = (date) => {
    if (!date) return "—";
    return new Date(date).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  };

const formatDuration = (start, end) => {
  if (!start || !end) return "--";

  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();

  if (endTime <= startTime) return "--";

  const diffMs = endTime - startTime;
  const totalMinutes = Math.floor(diffMs / 60000);

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes > 0
    ? `${hours} hr ${minutes} min`
    : `${hours} hr`;
};

const isCampaignFinished = (status) =>
  ["completed", "completed_with_errors", "failed"].includes(status);

return (
  <>
    {!isCampaignFinished(campaign.status) && (
      <div className="grid grid-cols-3 gap-3 mt-3">

        {/* Start Time */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-3 border border-green-200">
          <div className="flex items-center gap-2 mb-1">
            <Play size={14} className="text-green-600" />
            <span className="text-xs font-semibold text-green-700">
              Start Time
            </span>
          </div>
          <p className="text-sm font-medium text-slate-900">
            {timing.startTime ? formatTime(timing.startTime) : "Not started"}
          </p>
        </div>

        {/* End Time */}
        {timing.isActive ? (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-3 border border-blue-200">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={14} className="text-blue-600 animate-pulse" />
              <span className="text-xs font-semibold text-blue-700">
                End Time
              </span>
            </div>
            <p className="text-sm font-medium text-slate-900">
              {timing.estimatedCompletion
                ? formatTime(timing.estimatedCompletion)
                : "Calculating..."}
            </p>
          </div>
        ) : (
          <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-lg p-3 border border-purple-200">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={14} className="text-purple-600" />
              <span className="text-xs font-semibold text-purple-700">
                End Time
              </span>
            </div>
            <p className="text-sm font-medium text-slate-900">
              {timing.endTime ? formatTime(timing.endTime) : "—"}
            </p>
          </div>
        )}

        {/* Duration */}
        {/* <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
          <p className="text-xs font-semibold text-yellow-700 mb-1">
            Duration
          </p>
          <p className="text-sm font-medium text-slate-900">
              {formatDuration(timing.startTime, timing.endTime)}
          </p>
        </div> */}

      </div>
    )}
  </>
);

};

const TabButton = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-6 py-3 rounded-t-xl transition-all duration-200 ${
      active
        ? "bg-white text-blue-600 font-semibold shadow-sm"
        : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
    }`}
  >
    {icon}
    <span className="text-sm">{label}</span>
  </button>
);

const DashboardTab = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [stats, setStats] = useState({
    totalCampaigns: 0,
    totalRecipients: 0,
    totalFollowups: 0,
    followupEmails: 0
  });
  const [filter, setFilter] = useState("today");
  const [customDate, setCustomDate] = useState("");
  const [search, setSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    fetchCampaigns();

    // Reduced interval to 10 seconds for real-time updates
    const interval = setInterval(() => {
      fetchCampaigns(true); // Silent refresh
    }, 10000);

    return () => clearInterval(interval);
  }, [filter, customDate]);

  const fetchCampaigns = async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }

      const params = {};

      if (customDate) {
        params.date = customDate;
      } else {
        params.range = filter;
      }

      // Add timestamp to prevent caching
      params._t = Date.now();

      const response = await api.get("/api/campaigns/dashboard", { params });

      if (response.data.success) {
        const { stats, recentCampaigns } = response.data.data;
        setStats(stats);
        setCampaigns(recentCampaigns);
      }

    } catch (err) {
      if (!silent) {
        setError("Failed to fetch campaigns");
      }
      console.error("Error fetching campaigns:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleDelete = async (campaignId) => {
    if (!window.confirm("Are you sure you want to delete this campaign?")) {
      return;
    }

    try {
      setDeleting(campaignId);
      await api.delete(`/api/campaigns/${campaignId}`);
      
      // Immediate UI update
      setCampaigns(prev => prev.filter(c => c.id !== campaignId));
      
      // Force refresh to update stats
      await fetchCampaigns();
      
    } catch (err) {
      console.error("Delete error:", err);
      alert("Failed to delete campaign");
    } finally {
      setDeleting(null);
    }
  };

  const toggleRow = (id) => {
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const getCampaignLabel = (campaign) => {
  const now = new Date();

  // 🔥 IMMEDIATE CAMPAIGN
  if (campaign.sendType === "immediate") {
    if (["completed", "completed_with_errors", "failed"].includes(campaign.status)) {
      return "Completed";
    }
    return "Immediate";
  }

  // 🔵 FUTURE SCHEDULED
  if (campaign.status === "scheduled") {
    const scheduledTime = campaign.scheduledAt
      ? new Date(campaign.scheduledAt)
      : null;

    if (scheduledTime && scheduledTime > now) {
      return "Scheduled";
    }

    return "Sending";
  }

  if (campaign.status === "sending") return "Sending";
  if (campaign.status === "completed") return "Completed";

  return "Draft";
};


  const manualRefresh = async () => {
    await fetchCampaigns();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-slate-600 text-sm">Loading campaigns...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <p className="text-red-600 mb-3">{error}</p>
          <button
            onClick={manualRefresh}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          icon={<Send size={24} />}
          label="Total Campaigns"
          value={stats.totalCampaigns || 0}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
        />
        <StatCard
          icon={<Users size={24} />}
          label="Total Recipients"
          value={(stats.totalRecipients || 0).toLocaleString()}
          iconBg="bg-emerald-100"
          iconColor="text-emerald-600"
        />
        <StatCard
          icon={<UserPlus size={24} />}
          label="Follow-up Campaigns"
          value={stats.totalFollowups || 0}
          iconBg="bg-indigo-100"
          iconColor="text-indigo-600"
        />
        <StatCard
          icon={<Mail size={24} />}
          label="Follow-up Emails"
          value={(stats.followupEmails || 0).toLocaleString()}
          iconBg="bg-purple-100"
          iconColor="text-purple-600"
        />
      </div>

      {/* Filters & Search */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm mb-6">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            {["today", "week", "month"].map((f) => (
              <button
                key={f}
                onClick={() => {
                  setFilter(f);
                  setCustomDate("");
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  filter === f && !customDate
                    ? "bg-blue-600 text-white shadow-md"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <input
              type="date"
              value={customDate}
              onChange={(e) => {
                setCustomDate(e.target.value);
                setFilter("");
              }}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>

          <div className="flex gap-2 items-center w-full md:w-auto">
            <input
              type="text"
              placeholder="Search campaigns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 md:w-64 px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={manualRefresh}
              disabled={isRefreshing}
              className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              title="Refresh campaigns"
            >
              <RefreshCw size={18} className={isRefreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Campaigns Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {campaigns.length === 0 ? (
          <div className="text-center py-20">
            <Mail className="mx-auto text-slate-300 mb-4" size={48} />
            <p className="text-slate-500 text-lg">No campaigns found</p>
            <p className="text-slate-400 text-sm mt-2">Create your first campaign to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200">
                  <th className="px-6 py-4 text-left">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Campaign</span>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Type</span>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Recipients</span>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Date</span>
                  </th>
                  <th className="px-6 py-4 text-center">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
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
                      bg: "bg-blue-100",
                      text: "text-blue-700",
                      border: "border-blue-200",
                      icon: <Activity size={14} className="animate-pulse" />
                    },
                    scheduled: {
                      bg: "bg-indigo-100",
                      text: "text-indigo-700",
                      border: "border-indigo-200",
                      icon: <Calendar size={14} />
                    },
                    completed: {
                      bg: "bg-emerald-100",
                      text: "text-emerald-700",
                      border: "border-emerald-200",
                      icon: <TrendingUp size={14} />
                    },
                    completed_with_errors: {
                      bg: "bg-amber-100",
                      text: "text-amber-700",
                      border: "border-amber-200",
                      icon: <TrendingUp size={14} />
                    },
                    draft: {
                      bg: "bg-slate-100",
                      text: "text-slate-700",
                      border: "border-slate-200",
                      icon: <Mail size={14} />
                    },
                  };

                  const config = statusConfig[campaign.status] || statusConfig.draft;

                  return (
                    <>
                      <tr key={campaign.id} className="hover:bg-slate-50/70 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0`}>
                              <Mail className={config.text} size={18} />
                            </div>
                            <div>
                              <h3 className="font-semibold text-slate-900 text-sm">
                                {campaign.name?.replace(/\s*\(\d+\)\s*$/, "")}
                              </h3>
                              {campaign.fromNames?.length > 0 && (
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {campaign.fromNames.join(", ")}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                       <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium text-xs
                              ${
                                getCampaignLabel(campaign) === "Immediate"
                                  ? "bg-indigo-100 text-indigo-700 border-indigo-200"
                                  : getCampaignLabel(campaign) === "Scheduled"
                                  ? "bg-indigo-100 text-indigo-700 border-indigo-200"
                                  : getCampaignLabel(campaign) === "Sending"
                                  ? "bg-blue-100 text-blue-700 border-blue-200"
                                  : "bg-emerald-100 text-emerald-700 border-emerald-200"
                              }
                            `}
                          >
                            {getCampaignLabel(campaign)}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Users size={16} className="text-slate-400" />
                            <span className="text-sm font-semibold text-slate-900">
                              {(campaign.recipients?.length || 0).toLocaleString()}
                            </span>
                            <span className="text-xs text-slate-500">recipients</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Calendar size={16} className="text-slate-400" />
                            <span className="text-sm text-slate-700">{date}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex gap-2 justify-center">
                            {(campaign.status === "sending" || campaign.status === "completed" || campaign.status === "completed_with_errors") && (
                              <button
                                onClick={() => toggleRow(campaign.id)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors text-xs font-medium"
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
                              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
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
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (campaign.status === "sending" || campaign.status === "completed" || campaign.status === "completed_with_errors") && (
                        <tr>
                          <td colSpan={5} className="px-6 py-0 bg-slate-50/30">
                            <div className="py-4">
                              {/* Campaign Timing */}
                              <CampaignTiming campaign={campaign} />
                              
                              {/* Progress for active campaigns */}
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
        )}
      </div>
    </div>
  );
};

const StatCard = ({ icon, label, value, gradient, bgGradient, iconBg, iconColor }) => (
  <div className="group relative">
    <div className="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl blur-xl -z-10" 
         style={{ background: `linear-gradient(135deg, var(--tw-gradient-stops))` }} />
    <div className={`bg-white rounded-2xl p-6 border border-slate-200 hover:border-slate-300 transition-all shadow-sm hover:shadow-md`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center`}>
          <div className={iconColor}>{icon}</div>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-slate-500 mb-1">{label}</p>
        <p className="text-3xl font-bold text-slate-900">{value}</p>
      </div>
    </div>
  </div>
);