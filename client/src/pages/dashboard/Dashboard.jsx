import { useEffect, useState } from "react";
import { api } from "../utils/api";
import PageHeader from "../../components/layout/PageHeader";
import {
  Mail,
  Users,
  Megaphone,
  TrendingUp,
  Send,
  Inbox,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Target,
  Calendar,
  Loader2,
} from "lucide-react";

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState({
    todayCampaigns: 0,
    totalCampaigns: 0,
    emailsSentToday: 0,
    activeCampaigns: 0,
    todayLeads: 0,
    totalLeads: 0,
    recentCampaigns: [],
    scheduledCampaigns: [],
    recentActivity: [],
    topCampaigns: [],
    upcomingFollowups: [],
  });

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Fetch all required data
      const [campaignsRes, leadsRes, accountsRes] = await Promise.all([
        api.get("/api/campaigns"),
        api.get("/api/leads"),
        api.get("/api/accounts"),
      ]);

      const campaigns = campaignsRes.data?.data || [];
      const leads = leadsRes.data?.leads || [];
      const accounts = accountsRes.data?.data || [];

      // Calculate today's campaigns
      const todayCampaigns = campaigns.filter((c) => {
        const campaignDate = new Date(c.createdAt);
        campaignDate.setHours(0, 0, 0, 0);
        return campaignDate.getTime() === today.getTime();
      }).length;

      // Calculate emails sent today
      const emailsSentToday = campaigns.reduce((sum, campaign) => {
        const campaignDate = new Date(campaign.createdAt);
        campaignDate.setHours(0, 0, 0, 0);
        if (
          campaignDate.getTime() === today.getTime() &&
          campaign.status === "completed"
        ) {
          // was campaign.recipients?.length — that array is no longer sent
          return sum + (campaign.sentCount ?? 0);
        }
        return sum;
      }, 0);

      // Calculate active campaigns (sending status)
      const activeCampaigns = campaigns.filter(
        (c) => c.status === "sending",
      ).length;

      // Calculate today's leads
      const todayLeads = leads.filter((l) => {
        const leadDate = new Date(l.createdAt);
        leadDate.setHours(0, 0, 0, 0);
        return leadDate.getTime() === today.getTime();
      }).length;

      // Get recent campaign performance (completed campaigns with recipients)
      const recentCampaigns = campaigns
        .filter((c) => c.status === "completed")
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 4)
        .map((c) => {
          // Real delivery rate. The old formula was
          //   len / max(len, 100) * 100
          // which returned 100% for any campaign with 100+ recipients and
          // the raw count otherwise — it never measured delivery.
          const total = c.recipientCount ?? 0;
          const sent  = c.sentCount ?? 0;
          return {
            name: c.name || "Untitled Campaign",
            performance: total > 0 ? Math.round((sent / total) * 100) : 0,
            sentCount: sent,
            totalRecipients: total,
          };
        });

      // Get scheduled campaigns
      const scheduledCampaigns = campaigns
        .filter((c) => c.status === "scheduled")
        .sort(
          (a, b) =>
            new Date(a.scheduledTime || a.createdAt) -
            new Date(b.scheduledTime || b.createdAt),
        )
        .slice(0, 4)
        .map((c) => ({
          name: c.name || "Untitled Campaign",
          time: new Date(c.scheduledTime || c.createdAt).toLocaleString(),
        }));

      // Generate recent activity
      const recentActivity = [];

      // Add recent campaign activities
      campaigns.slice(0, 2).forEach((c) => {
        if (c.status === "completed") {
          recentActivity.push({
            type: "campaign",
            icon: <Megaphone className="w-4 h-4" />,
            text: `Campaign launched: ${c.name || "Untitled"}`,
            time: getTimeAgo(c.createdAt),
          });
        }
      });

      // Add recent leads
      leads.slice(0, 2).forEach((l) => {
        recentActivity.push({
          type: "lead",
          icon: <Mail className="w-4 h-4" />,
          text: `New lead: ${l.email || "Unknown"}`,
          time: getTimeAgo(l.createdAt),
        });
      });

      // Sort by time and limit to 4
      recentActivity.sort((a, b) => b.time.localeCompare(a.time));
      const limitedActivity = recentActivity.slice(0, 4);

      // Get top campaigns by recipient count
      const maxRecipients = Math.max(
        1,
        ...campaigns.map((camp) => camp.recipientCount ?? 0),
      );

      const topCampaigns = campaigns
        .filter((c) => (c.recipientCount ?? 0) > 0)
        .sort((a, b) => (b.recipientCount ?? 0) - (a.recipientCount ?? 0))
        .slice(0, 4)
        .map((c) => ({
          name: c.name || "Untitled Campaign",
          company: `${c.recipientCount} recipients`,
          score: Math.min(
            100,
            Math.round(
              ((c.recipientCount ?? 0) /
                maxRecipients) *
                100,
            ),
          ),
        }));

      // Get upcoming follow-ups (scheduled campaigns)
      const now = Date.now();
      const days2 = 2 * 24 * 60 * 60 * 1000;

      /* ✅ Step 1: Find all completed follow-up campaigns */
      const completedFollowups = campaigns.filter(
        (c) =>
          c.sendType === "followup" &&
          c.status === "completed" &&
          c.parentCampaignId !== null,
      );

      /* ✅ Step 2: Collect parent campaign IDs */
      const campaignsWithFollowup = new Set(
        completedFollowups.map((f) => f.parentCampaignId),
      );

    const priorityRank = {
  high: 1,
  medium: 2,
  low: 3,
};

const upcomingFollowups = campaigns
  .filter((c) => {
    if (c.status !== "completed") return false;
    if (c.sendType === "followup") return false;

    // ❌ Skip if follow-up already completed
    if (campaignsWithFollowup.has(c.id)) return false;

    return true; // ✅ No date restriction now
  })

  // ✅ Assign priority + label
  .map((c) => {
    const completedTime = new Date(c.createdAt).getTime();
    const diffDays = Math.floor(
      (now - completedTime) / (24 * 60 * 60 * 1000)
    );

    // Time label
    let timeLabel = "Today";
    if (diffDays === 1) timeLabel = "Yesterday";
    if (diffDays >= 2) timeLabel = `${diffDays} days ago`;

    // ✅ Priority rule
    let priority = "low"; // Today
    if (diffDays === 1) priority = "medium"; // Yesterday
    if (diffDays >= 2) priority = "high"; // 2+ days old

    return {
      id: c.id,
      name: c.name || "Untitled Campaign",
      task: "Follow-up required",
      time: timeLabel,
      priority,
      createdAt: c.createdAt,
    };
  })

  // ✅ Sort High → Medium → Low first
  .sort((a, b) => {
    if (priorityRank[a.priority] !== priorityRank[b.priority]) {
      return priorityRank[a.priority] - priorityRank[b.priority];
    }

    // Same priority → oldest first (more urgent)
    return new Date(a.createdAt) - new Date(b.createdAt);
  })

  // ✅ Take top 10 urgent follow-ups
  .slice(0, 10);


      setDashboardData({
        todayCampaigns,
        totalCampaigns: campaigns.length,
        emailsSentToday,
        activeCampaigns,
        todayLeads,
        totalLeads: leads.length,
        recentCampaigns,
        scheduledCampaigns,
        recentActivity: limitedActivity,
        topCampaigns,
        upcomingFollowups,
      });
    } catch (error) {
      console.error("Dashboard fetch error:", error);
    }
    setLoading(false);
  };

  const getTimeAgo = (date) => {
    const now = new Date();
    const past = new Date(date);
    const diffMs = now - past;
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.round(diffMins / 60)}h ago`;
    return `${Math.round(diffMins / 1440)}d ago`;
  };

  const formatScheduledTime = (date) => {
    const now = new Date();
    const scheduled = new Date(date);
    const diffMs = scheduled - now;
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));

    if (diffHours < 24) {
      return `Today, ${scheduled.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
    } else if (diffHours < 48) {
      return `Tomorrow, ${scheduled.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
    } else {
      return scheduled.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto mb-4" />
          <p className="text-slate-600 dark:text-slate-400">
            Loading dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      {/* Header */}
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your CRM performance"
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <StatCard
          title="Today Campaigns"
          value={dashboardData.todayCampaigns}
          icon={<Users />}
          trend={`Total: ${dashboardData.totalCampaigns}`}
        />
        <StatCard
          title="Emails Sent Today"
          value={dashboardData.emailsSentToday}
          icon={<Mail />}
          trend={`Active: ${dashboardData.activeCampaigns}`}
        />
        <StatCard
          title="Active Campaigns"
          value={dashboardData.activeCampaigns}
          icon={<Megaphone />}
          trend="Sending now"
        />
        <StatCard
          title="Today Leads"
          value={dashboardData.todayLeads}
          icon={<TrendingUp />}
          trend={`Total: ${dashboardData.totalLeads}`}
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Campaign Performance */}
        <div className="xl:col-span-2 bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition">
          <h3 className="font-semibold text-lg mb-6 dark:text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-green-600" />
            Recent Campaign Performance
          </h3>

          <div className="space-y-4">
            {dashboardData.recentCampaigns.length > 0 ? (
              dashboardData.recentCampaigns.map((campaign, index) => (
                <ProgressRow
                  key={index}
                  label={
                    campaign.totalRecipients > 0
                      ? `${campaign.name} — ${campaign.sentCount}/${campaign.totalRecipients} sent`
                      : `${campaign.name} — no recipients`
                  }
                  value={campaign.performance}
                />
              ))
            ) : (
              <p className="text-slate-500 dark:text-slate-400 text-center py-8">
                No completed campaigns yet
              </p>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition">
          <h3 className="font-semibold text-lg mb-6 dark:text-white flex items-center gap-2">
            <Inbox className="w-5 h-5 text-green-600" />
            Scheduled Campaigns
          </h3>

          <ul className="space-y-4 text-sm">
            {dashboardData.scheduledCampaigns.length > 0 ? (
              dashboardData.scheduledCampaigns.map((campaign, index) => (
                <ActivityItem
                  key={index}
                  icon={<Calendar className="w-4 h-4" />}
                  text={campaign.name}
                  time={campaign.time}
                />
              ))
            ) : (
              <p className="text-slate-500 dark:text-slate-400 text-center py-4">
                No scheduled campaigns
              </p>
            )}
          </ul>
        </div>
      </div>

      {/* Additional Sections */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top Campaigns by Recipients */}
        <div className="bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition">
          <h3 className="font-semibold text-lg mb-6 dark:text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            Top Campaigns by Recipients
          </h3>

          <div className="space-y-4">
            {dashboardData.topCampaigns.length > 0 ? (
              dashboardData.topCampaigns.map((campaign, index) => (
                <LeadRow
                  key={index}
                  name={campaign.name}
                  company={campaign.company}
                  score={campaign.score}
                />
              ))
            ) : (
              <p className="text-slate-500 dark:text-slate-400 text-center py-8">
                No campaigns with recipients yet
              </p>
            )}
          </div>
        </div>

        {/* Upcoming Follow-ups */}
        <div className="bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition">
          <h3 className="font-semibold text-lg mb-6 dark:text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-green-600" />
            Upcoming Follow-ups
          </h3>

          {/* ✅ Scrollable Follow-up List */}
          <div className="space-y-4 min-h-[250px] max-h-[350px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-green-500 scrollbar-track-slate-200 dark:scrollbar-track-slate-800">
            {dashboardData.upcomingFollowups.length > 0 ? (
              dashboardData.upcomingFollowups.map((followup, index) => (
                <FollowUpItem
                  key={index}
                  name={followup.name}
                  task={followup.task}
                  time={followup.time}
                  priority={followup.priority}
                />
              ))
            ) : (
              <p className="text-slate-500 dark:text-slate-400 text-center py-8">
                No upcoming follow-ups scheduled
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
        <NavButton
          title="Campaigns"
          description="Manage your email campaigns"
          icon={<Megaphone className="w-6 h-6" />}
          href="/campaigns"
        />
        <NavButton
          title="Leads"
          description="View and manage all leads"
          icon={<Users className="w-6 h-6" />}
          href="/leads"
        />
        <NavButton
          title="Analytics"
          description="View detailed analytics"
          icon={<CheckCircle className="w-6 h-6" />}
          href="/analytics"
        />
      </div>
    </div>
  );
}

/* --- Components --- */

function StatCard({ title, value, icon, trend }) {
  return (
    <div className="bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          {title}
        </p>
        <div className="text-green-600 dark:text-green-400">{icon}</div>
      </div>
      <h2 className="text-3xl font-bold dark:text-white mb-1">{value}</h2>
      <p className="text-xs text-green-600 dark:text-green-500 font-medium">
        {trend}
      </p>
    </div>
  );
}

function ProgressRow({ label, value }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="text-slate-600 dark:text-slate-400 font-medium">
          {label}
        </span>
        <span className="font-semibold dark:text-white">{value}%</span>
      </div>
      <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2.5">
        <div
          className="bg-gradient-to-r from-green-600 to-emerald-500 h-2.5 rounded-full transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function ActivityItem({ icon, text, time, alert }) {
  return (
    <li className="flex items-start gap-3 group">
      <div
        className={`mt-0.5 ${alert ? "text-red-500" : "text-green-600 dark:text-green-400"}`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-slate-700 dark:text-slate-300 truncate">{text}</p>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {time}
        </span>
      </div>
    </li>
  );
}

function LeadRow({ name, company, score }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition">
      <div>
        <p className="font-medium text-slate-900 dark:text-white">{name}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">{company}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-16 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-600 rounded-full"
            style={{ width: `${score}%` }}
          />
        </div>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 w-8 text-right">
          {score}
        </span>
      </div>
    </div>
  );
}

function FollowUpItem({ name, task, time, priority }) {
  const priorityColors = {
    high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    medium:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  };

  return (
    <div className="flex items-start justify-between p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition">
      <div className="flex-1">
        <p className="font-medium text-slate-900 dark:text-white">{name}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">{task}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
          {time}
        </p>
      </div>
      <span
        className={`text-xs px-2 py-1 rounded-full font-medium ${priorityColors[priority]}`}
      >
        {priority}
      </span>
    </div>
  );
}

function NavButton({ title, description, icon, href }) {
  return (
    <a
      href={href}
      className="group bg-gradient-to-br from-green-50 to-emerald-50 dark:from-slate-800 dark:to-slate-900 border border-green-100 dark:border-slate-700 rounded-2xl p-6 hover:shadow-lg hover:scale-105 transition-all duration-200"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-green-600 dark:text-green-400">{icon}</div>
        <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-green-600 dark:group-hover:text-green-400 group-hover:translate-x-1 transition-all" />
      </div>
      <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
        {title}
      </h4>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {description}
      </p>
    </a>
  );
}