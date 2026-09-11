// client/src/pages/analytics/AnalyticsDashboard.jsx
import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { 
  TrendingUp, 
  Send, 
  Users, 
  Mail, 
  Calendar, 
  CheckCircle, 
  Clock, 
  Repeat, 
  FileText,
  Activity,
  Filter,
  Loader2,
  BarChart3,
  Target,
  Zap
} from 'lucide-react';

const AnalyticsDashboard = () => {
  const [stats, setStats] = useState({
    campaigns: { total: 0, completed: 0, scheduled: 0, sending: 0, draft: 0 },
    followups: { total: 0, sent: 0, pending: 0 },
    leads: { total: 0, today: 0 },
    pitches: { total: 0 },
    accounts: { total: 0, totalDomains: 0, byDomain: [] },
    recipients: {
      total: 0,
      sent: 0,
      pending: 0,
      failed: 0
    }
  });

  const [dateRange, setDateRange] = useState('all');
  const [customDate, setCustomDate] = useState('');
  const [chartData, setChartData] = useState([]);
  const [chartFilter, setChartFilter] = useState("all"); // all | campaigns | leads
  const [openDomain, setOpenDomain] = useState(null);
  const [loading, setLoading] = useState(true);
 

  const [todayReport, setTodayReport] = useState({
    totalAccounts: 0,
    totalSent: 0,
    totalLeads: 0,
    rows: [] // { email, domain, sent, leads }
  });

  useEffect(() => {
    fetchAnalytics();
    fetchTodayReport(); // ✅ ADD THIS
  }, [dateRange, customDate]);


  const fetchAnalytics = async () => {
    setLoading(true);
    try {
        const params = {
          range: dateRange // 🔥 ALWAYS SEND
        };

        if (dateRange === "custom" && customDate) {
          params.date = customDate;
        }


      const [campaignsRes, leadsRes, pitchesRes, accountsRes, pendingFollowupsRes] = await Promise.all([
        api.get('/api/campaigns/dashboard', { params }),
        api.get('/api/leads'),
        api.get('/api/pitches'),
        api.get('/api/accounts'),
        api.get('/api/campaigns')
      ]);

      const campaignData = campaignsRes.data?.data || {};
      const campaigns = campaignData.recentCampaigns || [];
      
      const campaignStats = campaignData.stats || {};
      const pendingFollowups = pendingFollowupsRes.data?.data?.length || 0;
      
 
      
      const leads = leadsRes.data?.leads || [];
      const pitches = pitchesRes.data?.data || [];
      const accountsData = accountsRes.data?.data || [];

      // Process campaigns status
      const completed = campaigns.filter(c => c.status === 'completed').length;
      const scheduled = campaigns.filter(c => c.status === 'scheduled').length;
      const sending = campaigns.filter(c => c.status === 'sending').length;
      const draft = campaigns.filter(c => c.status === 'draft').length;
      
      // Process followups
      const followupCampaigns = campaigns.filter(c => c.sendType === 'followup');
      const followupsSent = followupCampaigns.filter(f => f.status === 'completed').length;

      // Process leads
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayLeads = leads.filter(l => {
        const leadDate = new Date(l.createdAt);
        leadDate.setHours(0, 0, 0, 0);
        return leadDate.getTime() === today.getTime();
      }).length;

      // Group accounts by provider/domain
      const domainMap = {};

      accountsData.forEach(acc => {
        const provider = acc.provider || 'custom';

        if (!domainMap[provider]) {
          domainMap[provider] = [];
        }

        domainMap[provider].push(acc.email);
      });


      // Calculate total recipients from campaigns
      const totalRecipients = campaigns.reduce((sum, c) => {
        return sum + (c.recipients?.length || 0);
      }, 0);

    setStats({
      campaigns: {
        total: campaignStats.totalCampaigns || 0,
        completed: campaigns.filter(c => c.status === 'completed').length,
        scheduled: campaigns.filter(c => c.status === 'scheduled').length,
        sending: campaigns.filter(c => c.status === 'sending').length,
        draft: campaigns.filter(c => c.status === 'draft').length
      },

      followups: {
        total: campaignStats.totalFollowups || 0,
        sent: campaigns.filter(
          c => c.sendType === 'followup' && c.status === 'completed'
        ).length,
        pending: pendingFollowups
      },

      recipients: {
        total: campaignStats.totalRecipients || 0,
        sent: campaignStats.sentRecipients || 0,
        pending: campaignStats.pendingRecipients || 0,
        failed: campaignStats.failedRecipients || 0
      },

      leads: {
        total: leads.length,
        today: todayLeads
      },

      pitches: {
        total: pitches.length
      },

      accounts: {
        total: accountsData.length,
        totalDomains: Object.keys(domainMap).length,
        byDomain: Object.entries(domainMap).map(([domain, emails]) => ({
          domain,
          count: emails.length,
          emails
        }))
      }
    });



      generateChartData(campaigns, leads);
    } catch (error) {
      console.error('Analytics fetch error:', error);
    }
    setLoading(false);
  };

  const generateChartData = (campaigns, leads) => {
    const data = [];
    const days = 30;

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);

      const dayCampaigns = campaigns.filter(c => {
        const cDate = new Date(c.createdAt);
        return cDate >= date && cDate < nextDay;
      }).length;

      const dayLeads = leads.filter(l => {
        const lDate = new Date(l.createdAt);
        return lDate >= date && lDate < nextDay;
      }).length;

      // ✅ ONLY PUSH IF AT LEAST ONE HAS VALUE
      if (dayCampaigns > 0 || dayLeads > 0) {
        data.push({
          date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          campaigns: dayCampaigns,
          leads: dayLeads
        });
      }
    }

    setChartData(data);
  };

const fetchTodayReport = async () => {
  try {
    const res = await api.get('/api/analytics/today');
    const data = res.data;

    setTodayReport({
      totalAccounts: data.emailAccountsUsed || 0,
      totalSent: data.totalSent || 0,
      totalLeads: data.totalLeads || 0,
      rows: data.rows || []
    });
  } catch (error) {
    console.error('Failed to fetch today report:', error);
  }
};


 
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-50 via-blue-50 to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-sky-600 animate-spin" />
          <p className="text-sky-600 font-semibold text-lg">Loading Analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-blue-50 to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 p-6">
      <div className="max-w-9xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 border border-sky-100 dark:border-sky-900">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-sky-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-3">
                <BarChart3 className="w-8 h-8 text-sky-600" />
                Analytics Dashboard
              </h1>
              <p className="text-slate-600 dark:text-slate-400 mt-2">
                Monitor your campaign performance and lead generation metrics
              </p>
            </div>
            
            {/* Date Filter */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value)}
                  className="pl-10 pr-8 py-3 rounded-xl border border-sky-200 dark:border-sky-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all duration-200 appearance-none cursor-pointer min-w-[180px] font-medium"
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="custom">Custom Date</option>
                </select>
              </div>
              
              {dateRange === 'custom' && (
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="px-4 py-3 rounded-xl border border-sky-200 dark:border-sky-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all duration-200"
                />
              )}
            </div>
          </div>
        </div>

        {/* Main Stats Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
          <StatCard
            title="Total Campaigns"
            value={stats.campaigns.total}
            icon={<Send className="w-6 h-6" />}
            color="emerald"
            details={[
              { label: 'Completed', value: stats.campaigns.completed, icon: <CheckCircle className="w-4 h-4" /> },
              { label: 'Scheduled', value: stats.campaigns.scheduled, icon: <Clock className="w-4 h-4" /> },
              { label: 'Active', value: stats.campaigns.sending, icon: <Zap className="w-4 h-4" /> },
              { label: 'Draft', value: stats.campaigns.draft, icon: <FileText className="w-4 h-4" /> }
            ]}
          />

          <StatCard
            title="Total Recipients"
            value={stats.recipients.total}
            icon={<Users className="w-6 h-6" />}
            color="teal"
            details={[
              { label: 'Sent', value: stats.recipients.sent, icon: <CheckCircle className="w-4 h-4" /> },
              { label: 'Pending', value: stats.recipients.pending, icon: <Clock className="w-4 h-4" /> },
              { label: 'Failed', value: stats.recipients.failed, icon: <Activity className="w-4 h-4" /> }
            ]}
          />

          <StatCard
            title="Follow-ups"
            value={stats.followups.total}
            icon={<Repeat className="w-6 h-6" />}
            color="green"
            details={[
              { label: 'Sent', value: stats.followups.sent, icon: <CheckCircle className="w-4 h-4" /> },
              { label: 'Pending', value: stats.followups.pending, icon: <Clock className="w-4 h-4" /> }
            ]}
          />

          <StatCard
            title="Leads Generated"
            value={stats.leads.total}
            icon={<Target className="w-6 h-6" />}
            color="amber"
            details={[
              { label: 'Total Leads', value: stats.leads.total, icon: <Users className="w-4 h-4" /> },
              { label: 'Today', value: stats.leads.today, icon: <Calendar className="w-4 h-4" /> },
              { label: 'Total Pitches', value: stats.pitches.total, icon: <FileText className="w-4 h-4" /> }
            ]}
          />
        </div>

        {/* Secondary Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Email Accounts Card */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 border border-sky-100 dark:border-sky-900">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-lg">
                <Mail className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Email Accounts</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">Connected accounts overview</p>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 rounded-xl border border-sky-100 dark:border-sky-900">
                <span className="text-slate-700 dark:text-slate-300 font-medium">Total Accounts</span>
                <span className="text-2xl font-bold text-sky-600">{stats.accounts.total}</span>
              </div>
              
              {/* <div className="flex items-center justify-between p-4 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 rounded-xl border border-blue-100 dark:border-blue-900">
                <span className="text-slate-700 dark:text-slate-300 font-medium">Unique Domains</span>
                <span className="text-2xl font-bold text-blue-600">{stats.accounts.totalDomains}</span>
              </div>  */}
            </div>

            {stats.accounts.byDomain.length > 0 && (
              <div className="mt-6 space-y-2">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Domain Breakdown</h4>
                {stats.accounts.byDomain.map((domain, idx) => (
                  <div key={idx} className="group">
                    <button
                      onClick={() => setOpenDomain(openDomain === idx ? null : idx)}
                      className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-all duration-200 border border-slate-200 dark:border-slate-600"
                    >
                      <span className="font-medium text-slate-900 dark:text-white capitalize">{domain.domain}</span>
                      <span className="px-3 py-1 bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 rounded-full text-sm font-semibold">
                        {domain.count} {domain.count === 1 ? 'account' : 'accounts'}
                      </span>
                    </button>
                    
                    {openDomain === idx && (
                      <div className="mt-2 ml-4 space-y-1 animate-fadeIn">
                        {domain.emails.map((email, emailIdx) => (
                          <div
                            key={emailIdx}
                            className="text-sm text-slate-600 dark:text-slate-400 p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-600"
                          >
                            {email}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Performance Overview */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 border border-sky-100 dark:border-sky-900">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-sky-600 text-white shadow-lg">
                <Activity className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Live Performance</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">Real-time metrics</p>
              </div>
            </div>
            <div className="space-y-3">
              <QuickStat label="Total Recipients" value={stats.recipients.total} icon={<Users className="w-5 h-5" />} />
              <QuickStat label="Active Campaigns" value={stats.campaigns.sending} icon={<Send className="w-5 h-5" />} />
              <QuickStat label="Scheduled" value={stats.campaigns.scheduled} icon={<Clock className="w-5 h-5" />} />
              <QuickStat label="Success Rate" value={`${stats.campaigns.total > 0 ? Math.round((stats.campaigns.completed / stats.campaigns.total) * 100) : 0}%`} icon={<TrendingUp className="w-5 h-5" />} />
            </div>
          </div>
        </div>

        {/* Activity Chart */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 border border-sky-100 dark:border-sky-900">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-lg">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Monthly Activity Trend</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">Last 30 days performance</p>
              </div>
            </div>
            
            <div className="flex gap-2">
              {["all", "campaigns", "leads"].map(type => (
                <button
                  key={type}
                  onClick={() => setChartFilter(type)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                    chartFilter === type 
                      ? "bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-lg shadow-sky-500/30"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                  }`}
                >
                  {type.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto pb-4">
            <div className="flex gap-4 min-w-max">
              {chartData.map((item, idx) => {
                const maxVal = Math.max(...chartData.map(d => Math.max(d.campaigns, d.leads)), 1);
                const campaignHeight = Math.max((item.campaigns / maxVal) * 200, 5);
                const leadHeight = Math.max((item.leads / maxVal) * 200, 5);

                return (
                  <div key={idx} className="flex flex-col items-center min-w-[90px]">
                    <div className="flex gap-3 mb-3 h-52 items-end">
                      {(chartFilter === "all" || chartFilter === "campaigns") && (
                        <div className="relative group">
                          <div
                            className="w-10 bg-gradient-to-t from-sky-600 to-sky-400 rounded-t-lg shadow-lg hover:shadow-sky-500/50 transition-all duration-200"
                            style={{ height: `${campaignHeight}px` }}
                          />
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hidden group-hover:block bg-slate-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap shadow-xl z-10">
                            {item.campaigns} campaigns
                          </div>
                        </div>
                      )}

                      {(chartFilter === "all" || chartFilter === "leads") && (
                        <div className="relative group">
                          <div
                            className="w-10 bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-lg shadow-lg hover:shadow-blue-500/50 transition-all duration-200"
                            style={{ height: `${leadHeight}px` }}
                          />
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hidden group-hover:block bg-slate-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap shadow-xl z-10">
                            {item.leads} leads
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">{item.date}</span>
                  </div>
                );
              })}
            </div>
          </div>
          
          <div className="flex justify-center gap-8 mt-6 pt-4 border-t border-sky-100 dark:border-sky-900">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-gradient-to-br from-sky-500 to-sky-600 rounded shadow"></div>
              <span className="text-slate-700 dark:text-slate-300 font-semibold">Campaigns</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded shadow"></div>
              <span className="text-slate-700 dark:text-slate-300 font-semibold">Leads</span>
            </div>
          </div>
        </div>

        {/* Today Campaign Report */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 border border-sky-100 dark:border-sky-900">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-lg">
              <FileText className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Today's Campaign Report</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">Daily performance breakdown</p>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <SummaryCard 
              title="Email Accounts Used" 
              value={todayReport.totalAccounts}
              gradient="from-sky-500 to-blue-600"
              icon={<Mail className="w-5 h-5" />}
            />
            <SummaryCard 
              title="Emails Sent Today" 
              value={todayReport.totalSent}
              gradient="from-blue-500 to-cyan-600"
              icon={<Send className="w-5 h-5" />}
            />
            <SummaryCard 
              title="Leads Generated Today" 
              value={todayReport.totalLeads}
              gradient="from-blue-500 to-sky-600"
              icon={<Target className="w-5 h-5" />}
            />
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-sky-100 dark:border-sky-900">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-bold text-slate-900 dark:text-white">Email Account</th>
                  <th className="px-6 py-4 text-left text-sm font-bold text-slate-900 dark:text-white">Domain</th>
                  <th className="px-6 py-4 text-center text-sm font-bold text-slate-900 dark:text-white">Today Sent</th>
                  <th className="px-6 py-4 text-center text-sm font-bold text-slate-900 dark:text-white">Leads</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {todayReport.rows.map((r, idx) => (
                  <tr key={r.email} className="hover:bg-sky-50/50 dark:hover:bg-sky-900/10 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">{r.email}</td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{r.domain}</td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-bold text-sm">
                        {r.sent}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-bold text-sm">
                        {r.leads}
                      </span>
                    </td>
                  </tr>
                ))}

                {/* TOTAL */}
                <tr className="bg-gradient-to-r from-sky-100 to-blue-100 dark:from-sky-900/30 dark:to-blue-900/30 font-bold">
                  <td colSpan="2" className="px-6 py-4 text-slate-900 dark:text-white text-lg">
                    TOTAL
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-blue-600 text-white font-bold text-base shadow-lg">
                      {todayReport.totalSent}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-blue-600 text-white font-bold text-base shadow-lg">
                      {todayReport.totalLeads}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon, color, details }) => {
  const colorClasses = {
    emerald: 'from-sky-500 to-blue-600',
    teal: 'from-blue-500 to-cyan-600',
    green: 'from-blue-500 to-sky-600',
    amber: 'from-amber-500 to-orange-600'
  };

  const bgClasses = {
    emerald: 'from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20',
    teal: 'from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20',
    green: 'from-blue-50 to-sky-50 dark:from-blue-900/20 dark:to-sky-900/20',
    amber: 'from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20'
  };

  return (
    <div className={`group relative bg-gradient-to-br ${bgClasses[color]} p-6 rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 border border-sky-100 dark:border-sky-900`}>
      <div className="relative">
        <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${colorClasses[color]} flex items-center justify-center text-white mb-4 shadow-lg group-hover:scale-110 group-hover:rotate-6 transition-all duration-300`}>
          {icon}
        </div>
        <h3 className="text-slate-600 dark:text-slate-400 font-semibold text-sm mb-2">{title}</h3>
        <div className="text-4xl font-bold text-slate-900 dark:text-white mb-4 group-hover:scale-105 transition-transform duration-300">{value}</div>
        <div className="space-y-2 border-t border-sky-200 dark:border-sky-800 pt-3">
          {details.map((detail, idx) => (
            <div key={idx} className="flex items-center justify-between text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <span className="text-sky-600 dark:text-sky-400">{detail.icon}</span>
                <span className="text-sm font-medium">{detail.label}</span>
              </div>
              <span className="font-bold text-slate-900 dark:text-white">{detail.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${colorClasses[color]} transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300`}></div>
    </div>
  );
};

const QuickStat = ({ label, value, icon }) => (
  <div className="flex items-center justify-between p-4 bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 rounded-xl border border-sky-100 dark:border-sky-900 hover:shadow-md transition-all duration-200 group">
    <div className="flex items-center gap-3">
      <div className="text-sky-600 dark:text-sky-400 group-hover:scale-110 transition-transform duration-200">{icon}</div>
      <span className="text-slate-700 dark:text-slate-300 font-semibold">{label}</span>
    </div>
    <span className="text-2xl font-bold text-sky-600 dark:text-sky-400">{value}</span>
  </div>
);

const SummaryCard = ({ title, value, gradient, icon }) => (
  <div className={`bg-gradient-to-br ${gradient} p-6 rounded-xl shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 group`}>
    <div className="flex items-center justify-between mb-2">
      <div className="text-white/90 font-semibold text-sm">{title}</div>
      <div className="text-white/80 group-hover:scale-110 transition-transform duration-200">{icon}</div>
    </div>
    <div className="text-4xl font-bold text-white group-hover:scale-105 transition-transform duration-300">{value}</div>
  </div>
);


export default AnalyticsDashboard;