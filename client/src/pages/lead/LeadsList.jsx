import { useEffect, useState } from "react";
import PageHeader from "../../components/layout/PageHeader";
import { 
  Eye, 
  Pencil, 
  Trash2, 
  Mail, 
  User, 
  FileText, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Search,
  Filter,
  Download,
  TrendingUp,
  Building2,
  Globe,
  Phone,
  Calendar,
  Send
} from "lucide-react";
import { api } from "../utils/api";
import LeadDetail from "./LeadDetail";
import { toast } from "react-hot-toast";

export default function LeadsList() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState(null);
  const [openModal, setOpenModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const handleView = (lead) => {
    setSelectedLead({ ...lead, _mode: "view" });
    setOpenModal(true);
  };

  const handleEdit = (lead) => {
    setSelectedLead({ ...lead, _mode: "edit" });
    setOpenModal(true);
  };

  const handleSave = async (updatedLead) => {
    try {
      await api.put(`/api/leads/${updatedLead.id}`, updatedLead);
      toast.success("Lead updated successfully!");
      fetchLeads();
      setOpenModal(false);
    } catch (err) {
      toast.error("Failed to update lead");
      console.error(err);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const fetchLeads = async () => {
    try {
      setLoading(true);
      const res = await api.get("/api/leads");
      setLeads(res.data.leads || []);
    } catch (err) {
      console.error("Failed to fetch leads", err);
      toast.error("Failed to fetch leads");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this lead?")) return;

    try {
      await api.delete(`/api/leads/${id}`);
      setLeads((prev) => prev.filter((l) => l.id !== id));
      toast.success("Lead deleted successfully!");
    } catch (err) {
      toast.error("Failed to delete lead");
      console.error(err);
    }
  };

  // Filter and search
  const filteredLeads = leads.filter((lead) => {
    const matchesSearch = 
      lead.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.subject?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.toEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.fromEmail?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesFilter = 
      filterStatus === "all" ||
      (filterStatus === "completed" && lead.sentAt) ||
      (filterStatus === "pending" && !lead.sentAt);

    return matchesSearch && matchesFilter;
  });

  const pendingCount = leads.filter((l) => !l.sentAt).length;
  const completedCount = leads.filter((l) => l.sentAt).length;
  const conversionRate = leads.length > 0 ? ((completedCount / leads.length) * 100).toFixed(1) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-blue-50 to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 p-6">
      <div className="max-w-9xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 border border-sky-100 dark:border-sky-900">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-sky-600 to-blue-600 bg-clip-text text-transparent">
                Leads Management
              </h1>
              <p className="text-slate-600 dark:text-slate-400 mt-2">
                Track and manage your business leads efficiently
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button className="px-4 py-2 bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-xl hover:from-sky-700 hover:to-blue-700 transition-all duration-300 shadow-lg hover:shadow-sky-500/50 flex items-center gap-2">
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatCard 
            title="Total Leads" 
            value={leads.length} 
            icon={<FileText className="w-6 h-6" />}
            gradient="from-sky-500 to-blue-600"
            bgGradient="from-sky-50 to-blue-50"
            darkBgGradient="from-sky-900/20 to-blue-900/20"
          />
          <StatCard 
            title="Pending" 
            value={pendingCount} 
            icon={<Clock className="w-6 h-6" />}
            gradient="from-amber-500 to-orange-600"
            bgGradient="from-amber-50 to-orange-50"
            darkBgGradient="from-amber-900/20 to-orange-900/20"
          />
          <StatCard 
            title="Completed" 
            value={completedCount} 
            icon={<CheckCircle2 className="w-6 h-6" />}
            gradient="from-blue-500 to-sky-600"
            bgGradient="from-blue-50 to-sky-50"
            darkBgGradient="from-blue-900/20 to-sky-900/20"
          />
          <StatCard 
            title="Conversion Rate" 
            value={`${conversionRate}%`} 
            icon={<TrendingUp className="w-6 h-6" />}
            gradient="from-blue-500 to-cyan-600"
            bgGradient="from-blue-50 to-cyan-50"
            darkBgGradient="from-blue-900/20 to-cyan-900/20"
          />
        </div>

        {/* Search and Filter */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 border border-sky-100 dark:border-sky-900">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search by email, subject, or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-sky-200 dark:border-sky-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all duration-200"
              />
            </div>
            
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="pl-10 pr-8 py-3 rounded-xl border border-sky-200 dark:border-sky-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all duration-200 appearance-none cursor-pointer min-w-[200px]"
              >
                <option value="all">All Leads</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
        </div>

        {/* Leads Cards */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <User className="w-5 h-5 text-sky-600" />
              Leads Overview ({filteredLeads.length})
            </h3>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-slate-800 rounded-2xl shadow-xl">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-sky-100 dark:border-sky-900 rounded-full"></div>
                <div className="w-16 h-16 border-4 border-sky-600 border-t-transparent rounded-full animate-spin absolute top-0 left-0"></div>
              </div>
              <p className="text-slate-600 dark:text-slate-400 mt-4">Loading leads...</p>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-2xl shadow-xl">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-sky-100 dark:bg-sky-900/20 mb-4">
                <FileText className="w-10 h-10 text-sky-600" />
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-lg font-medium">No leads found</p>
              <p className="text-slate-400 dark:text-slate-500 text-sm mt-2">
                {searchTerm || filterStatus !== "all" 
                  ? "Try adjusting your search or filter" 
                  : "Start by adding your first lead"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredLeads.map((lead, index) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  index={index}
                  onView={handleView}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <LeadDetail
        open={openModal}
        lead={selectedLead}
        onClose={() => setOpenModal(false)}
        onSave={handleSave}
      />
    </div>
  );
}

function LeadCard({ lead, index, onView, onEdit, onDelete }) {
  return (
    <div className="group bg-white dark:bg-slate-800 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 border border-sky-100 dark:border-sky-900 overflow-hidden">
      {/* Card Header with Status Badge */}
      <div className="relative bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 p-6 border-b border-sky-100 dark:border-sky-900">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-lg group-hover:scale-110 transition-transform duration-200">
              {index + 1}
            </div>
            {/* <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Lead ID
              </p>
              <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                #{lead.id}
              </p>
            </div> */}
          </div>
          
          {/* Status Badge */}
          {lead.sentAt ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/30">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Completed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/30">
              <Clock className="w-3.5 h-3.5" />
              Pending
            </span>
          )}
          
        </div>
        
      </div>

      {/* Card Body with Lead Information */}
      <div className="p-6 space-y-4">
        
        {/* Lead Type */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Lead Type
          </span>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
            lead.leadType === "ASSOCIATION" 
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              : lead.leadType === "ATTENDEES"
              ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
              : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
          }`}>
            <Building2 className="w-3 h-3" />
            {lead.leadType || "ASSOCIATION"}
          </span>
        </div>

         {/* From Email */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
            <Mail className="w-4 h-4 text-sky-600" />
            Client Email
          </div>
          <p className="text-sky-600 dark:text-sky-400 font-medium pl-6 truncate" title={lead.fromEmail}>
            {lead.fromEmail || "—"}
          </p>
        </div>

        {/* To Email */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
            <Send className="w-4 h-4 text-sky-600" />
             Lead Email
          </div>
          <p className="text-slate-900 dark:text-white font-medium pl-6 truncate" title={lead.toEmail}>
            {lead.toEmail || "—"}
          </p>
        </div>

        {/* Subject */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
            <FileText className="w-4 h-4 text-sky-600" />
            Subject
          </div>
          <p className="text-slate-700 dark:text-slate-300 pl-6 line-clamp-2" title={lead.subject}>
            {lead.subject || "—"}
          </p>
        </div>

        {lead.country && (
          <div className="text-sm text-gray-600">
            🌍 Country: <span className="font-medium">{lead.country}</span>
          </div>
        )}


        {/* Sent At (if available) */}
        {lead.sentAt && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
              <Calendar className="w-4 h-4 text-sky-600" />
              Date : {new Date(lead.createdAt).toLocaleDateString()}
            </div>
           
          </div>
        )}
      </div>

      {/* Card Footer with Actions */}
      <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/50 border-t border-sky-100 dark:border-sky-900">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onView(lead)}
            title="View Details"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 hover:bg-sky-200 dark:hover:bg-sky-900/50 hover:scale-105 transition-all duration-200 shadow-md hover:shadow-lg font-medium text-sm"
          >
            <Eye size={16} />
            View
          </button>

          <button
            onClick={() => onEdit(lead)}
            title="Edit Lead"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50 hover:scale-105 transition-all duration-200 shadow-md hover:shadow-lg font-medium text-sm"
          >
            <Pencil size={16} />
            Edit
          </button>

          <button
            onClick={() => onDelete(lead.id)}
            title="Delete Lead"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 hover:scale-105 transition-all duration-200 shadow-md hover:shadow-lg font-medium text-sm"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, gradient, bgGradient, darkBgGradient }) {
  return (
    <div className={`group relative bg-gradient-to-br ${bgGradient} dark:${darkBgGradient} p-6 rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 border border-sky-100 dark:border-sky-900`}>
      <div className="relative flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
            {title}
          </p>
          <h2 className="text-4xl font-bold text-slate-900 dark:text-white group-hover:scale-105 transition-transform duration-300">
            {value}
          </h2>
        </div>
        <div className={`p-3 rounded-xl bg-gradient-to-br ${gradient} text-white shadow-lg group-hover:scale-110 group-hover:rotate-6 transition-all duration-300`}>
          {icon}
        </div>
      </div>
      <div className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${gradient} transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300`}></div>
    </div>
  );
}