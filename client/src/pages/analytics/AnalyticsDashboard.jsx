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
  Loader2
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
    rows: []
  });

  useEffect(() => {
    fetchAnalytics();
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

  const generateTodayReport = (campaigns, leads) => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const accountMap = {};

    // Count sent emails per account
    campaigns.forEach(c => {
      if (!c.sentAt && !c.updatedAt) return;

      const sentDate = new Date(c.sentAt || c.updatedAt);
      if (sentDate < start || sentDate > end) return;

      c.recipients?.forEach(r => {
        if (r.status !== 'sent') return;

        const email = c.fromEmail;
        if (!email) return;

        if (!accountMap[email]) {
          accountMap[email] = {
            email,
            domain: email.split('@')[1],
            sent: 0,
            leads: 0
          };
        }

        accountMap[email].sent += 1;
      });
    });

    // Count leads per account
    leads.forEach(l => {
      const leadDate = new Date(l.createdAt);
      if (leadDate < start || leadDate > end) return;

      const email = l.fromEmail;
      if (email && accountMap[email]) {
        accountMap[email].leads += 1;
      }
    });

    const rows = Object.values(accountMap);

    setTodayReport({
      totalAccounts: rows.length,
      totalSent: rows.reduce((s, r) => s + r.sent, 0),
      totalLeads: rows.reduce((s, r) => s + r.leads, 0),
      rows
    });
  };



  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Activity className="w-10 h-10 text-blue-600" />
            <h1 className="text-4xl font-bold text-gray-900">Analytics Dashboard</h1>
          </div>
          <p className="text-gray-600 text-lg">Monitor your email campaigns, leads, and performance</p>
        </div>

        {/* Date Filter */}
        <div className="mb-8 flex items-center gap-3 flex-wrap bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <Filter className="w-5 h-5 text-gray-600" />
          <span className="text-gray-700 font-medium">Filter:</span>
          {['all', 'today', 'week', 'month', 'custom'].map(range => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-5 py-2.5 rounded-lg font-medium transition-all duration-200 ${
                dateRange === range
                  ? 'bg-blue-600 text-white shadow-md scale-105'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:scale-105'
              }`}
            >
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </button>
          ))}
          {dateRange === 'custom' && (
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="px-4 py-2.5 rounded-lg bg-white text-gray-900 border-2 border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>

        

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Total Campaigns"
            value={stats.campaigns.total}
            icon={<TrendingUp className="w-8 h-8" />}
            color="blue"
            details={[
              { label: 'Completed', value: stats.campaigns.completed, icon: <CheckCircle className="w-4 h-4" /> },
              { label: 'Sent Recipients', value: stats.recipients.total, icon: <Mail className="w-4 h-4" /> },
              { label: 'Scheduled', value: stats.campaigns.scheduled, icon: <Calendar className="w-4 h-4" /> },
              { label: 'Sending', value: stats.campaigns.sending, icon: <Send className="w-4 h-4" /> },
              { label: 'Draft', value: stats.campaigns.draft, icon: <FileText className="w-4 h-4" /> },
            
             ]}
          />

          <StatCard
            title="Follow-ups"
            value={stats.followups.total}
            icon={<Repeat className="w-8 h-8" />}
            color="purple"
            details={[
              { label: 'Sent', value: stats.followups.sent, icon: <CheckCircle className="w-4 h-4" /> },
              { label: 'Pending', value: stats.followups.pending || 0, icon: <Clock className="w-4 h-4" /> }
            ]}
          />

          <StatCard
            title="Leads Generated"
            value={stats.leads.total}
            icon={<Users className="w-8 h-8" />}
            color="green"
            details={[
              { label: 'Today', value: stats.leads.today, icon: <Calendar className="w-4 h-4" /> },
              { label: 'All Time', value: stats.leads.total, icon: <Users className="w-4 h-4" /> }
            ]}
          />

          <StatCard
            title="Pitch Templates"
            value={stats.pitches.total}
            icon={<Mail className="w-8 h-8" />}
            color="orange"
            details={[
              { label: 'Active', value: stats.pitches.total, icon: <CheckCircle className="w-4 h-4" /> },
              { label: 'Recipients', value: stats.recipients.total, icon: <Users className="w-4 h-4" /> }
            ]}
          />
        </div>

        {/* Email Accounts & Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

              {/* Email Accounts */}
          <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200 hover:shadow-xl transition-shadow">
            <div className="flex items-center gap-3 mb-6">
              <Mail className="w-6 h-6 text-blue-600" />
              <h3 className="text-2xl font-bold text-gray-900">Email Accounts</h3>
            </div>
            <div className="text-5xl font-bold text-blue-600 mb-6">{stats.accounts.total}</div>
            <div className="space-y-3">
              <div className="text-sm text-gray-600 mb-3">
                  Domains: <b>{stats.accounts.totalDomains}</b> | Accounts: <b>{stats.accounts.total}</b>
                </div>

                {stats.accounts.byDomain.map(({ domain, count, emails }) => (
                  <div key={domain} className="border border-gray-200 rounded-lg">
                    
                    {/* Domain Header */}
                    <div
                      onClick={() => setOpenDomain(openDomain === domain ? null : domain)}
                      className="flex items-center justify-between p-4 bg-gray-50 cursor-pointer hover:bg-blue-50"
                    >
                      <div className="flex items-center gap-2">
                        <Send className="w-4 h-4 text-gray-600" />
                        <span className="font-medium capitalize">{domain}</span>
                      </div>
                      <span className="bg-blue-100 px-3 py-1 rounded-full font-bold">{count}</span>
                    </div>

                    {/* Dropdown Emails */}
                    {openDomain === domain && (
                      <div className="bg-white px-6 py-3 space-y-2">
                        {emails.map((email, i) => (
                          <div key={i} className="text-sm text-gray-700">
                            • {email}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

              {stats.accounts.byDomain.length === 0 && (
                <p className="text-gray-500 text-center py-4">No email accounts added yet</p>
              )}
            </div>
          </div>
          

          {/* Quick Stats */}
          <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200 hover:shadow-xl transition-shadow">
            <div className="flex items-center gap-3 mb-6">
              <Activity className="w-6 h-6 text-green-600" />
              <h3 className="text-2xl font-bold text-gray-900">Live Performance Overview</h3>
            </div>
            <div className="space-y-4">
              <QuickStat label="Total Recipients" value={stats.recipients.total} icon={<Users className="w-5 h-5" />} />
              <QuickStat label="Active Campaigns" value={stats.campaigns.sending} icon={<Send className="w-5 h-5" />} />
              <QuickStat label="Scheduled" value={stats.campaigns.scheduled} icon={<Clock className="w-5 h-5" />} />
              <QuickStat label="Success Rate" value={`${stats.campaigns.total > 0 ? Math.round((stats.campaigns.completed / stats.campaigns.total) * 100) : 0}%`} icon={<TrendingUp className="w-5 h-5" />} />
            </div>
          </div>
        </div>

             {/* Activity Chart */}
          <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
            <h3 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-blue-600" />
              Monthly Activity Trend
            </h3>
            <div className="flex gap-3 mb-4">
              {["all", "campaigns", "leads"].map(type => (
                <button
                  key={type}
                  onClick={() => setChartFilter(type)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium ${
                    chartFilter === type 
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-700"
                  }`}
                >
                  {type.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <div className="flex gap-4 min-w-max pb-4">
                {chartData.map((item, idx) => {
                  const maxVal = Math.max(...chartData.map(d => Math.max(d.campaigns, d.leads)), 1);
                  const campaignHeight = Math.max((item.campaigns / maxVal) * 180, 5);
                  const leadHeight = Math.max((item.leads / maxVal) * 180, 5);

                  return (
                    <div key={idx} className="flex flex-col items-center min-w-[90px] ml-5">
                     <div className="flex gap-3 mb-3 h-48 items-end">
                      {(chartFilter === "all" || chartFilter === "campaigns") && (
                       <div className="relative group">
                        <div
                          className="w-10 bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-lg"
                          style={{ height: `${campaignHeight}px` }}
                        />

                        {/* CENTER POPUP */}
                        <div className="absolute top-1/2 left-1/2 
                            -translate-x-1/2 -translate-y-1/2
                            hidden group-hover:block
                            bg-gray-900 text-white px-3 py-1.5 rounded text-sm">
                          {item.campaigns} campaigns
                        </div>
                      </div>

                      )}

                      {(chartFilter === "all" || chartFilter === "leads") && (
                       <div className="relative group">
                        <div
                          className="w-10 bg-gradient-to-t from-green-600 to-green-400 rounded-t-lg"
                          style={{ height: `${leadHeight}px` }}
                        />

                        {/* CENTER POPUP */}
                        <div className="absolute top-1/2 left-1/2 
                            -translate-x-1/2 -translate-y-1/2
                            hidden group-hover:block
                            bg-gray-900 text-white px-3 py-1.5 rounded text-sm">
                          {item.leads} leads
                        </div>
                      </div>

                      )}
                    </div>

                      <span className="text-sm text-gray-600 font-medium">{item.date}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-center gap-8 mt-6 pt-4 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-500 rounded"></div>
                <span className="text-gray-700 font-medium">Campaigns</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-500 rounded"></div>
                <span className="text-gray-700 font-medium">Leads</span>
              </div>
            </div>
          </div>

          {/* TODAY CAMPAIGN REPORT */}
          <div className="bg-white rounded-xl p-6 mt-5 shadow-lg border border-gray-200 mb-8">
            <div className="flex items-center gap-3 mb-6">
              <FileText className="w-7 h-7 text-blue-600" />
              <h2 className="text-3xl font-bold text-gray-900">
                Today Campaign Report
              </h2>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <SummaryCard title="Email Accounts Used" value={todayReport.totalAccounts} />
              <SummaryCard title="Emails Sent Today" value={todayReport.totalSent} />
              <SummaryCard title="Leads Generated Today" value={todayReport.totalLeads} />
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full border rounded-lg overflow-hidden">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left">Email Account</th>
                    <th className="px-4 py-3 text-left">Domain</th>
                    <th className="px-4 py-3 text-center">Today Sent</th>
                    <th className="px-4 py-3 text-center">Leads</th>
                  </tr>
                </thead>

                <tbody>
                  {todayReport.rows.map(r => (
                    <tr key={r.email} className="border-t">
                      <td className="px-4 py-3 font-medium">{r.email}</td>
                      <td className="px-4 py-3 text-gray-600">{r.domain}</td>
                      <td className="px-4 py-3 text-center font-bold">
                        {r.sent}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-green-600">
                        {r.leads}
                      </td>
                    </tr>
                  ))}

                  {/* TOTAL */}
                  <tr className="bg-blue-50 border-t font-bold">
                    <td colSpan="2" className="px-4 py-3">
                      TOTAL
                    </td>
                    <td className="px-4 py-3 text-center">
                      {todayReport.totalSent}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {todayReport.totalLeads}
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
    blue: 'from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700',
    purple: 'from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700',
    green: 'from-green-500 to-green-600 hover:from-green-600 hover:to-green-700',
    orange: 'from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700'
  };

  return (
    <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-200 hover:scale-105 cursor-pointer">
      <div className={`w-14 h-14 rounded-lg bg-gradient-to-br ${colorClasses[color]} flex items-center justify-center text-white mb-4`}>
        {icon}
      </div>
      <h3 className="text-gray-600 font-semibold text-sm mb-2">{title}</h3>
      <div className="text-4xl font-bold text-gray-900 mb-4">{value}</div>
      <div className="space-y-2 border-t border-gray-200 pt-3">
        {details.map((detail, idx) => (
          <div key={idx} className="flex items-center justify-between text-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">{detail.icon}</span>
              <span className="text-sm">{detail.label}</span>
            </div>
            <span className="font-bold text-gray-900">{detail.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const QuickStat = ({ label, value, icon }) => (
  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 transition-colors">
    <div className="flex items-center gap-3">
      <div className="text-blue-600">{icon}</div>
      <span className="text-gray-700 font-medium">{label}</span>
    </div>
    <span className="text-2xl font-bold text-gray-900">{value}</span>
  </div>
);

const SummaryCard = ({ title, value }) => (
  <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
    <div className="text-gray-600 font-medium mb-1">{title}</div>
    <div className="text-3xl font-bold text-gray-900">{value}</div>
  </div>
);


export default AnalyticsDashboard;