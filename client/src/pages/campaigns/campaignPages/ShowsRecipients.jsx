import { useEffect, useState } from "react";
import { Search, Trash2, Save, X, Loader2, UserX, CheckCircle2, Mail } from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function ShowsRecipients({ campaignId, onClose, onUpdated }) {
  const [recipients, setRecipients] = useState([]);
  const [filteredRecipients, setFilteredRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deletedIds, setDeletedIds] = useState(new Set());

  // ✅ Fetch recipients — only sent/completed (as per backend campaign completed sent mails)
  useEffect(() => {
    const fetchRecipients = async () => {
      try {
        const token = localStorage.getItem("token");
        console.log("Fetching recipients for campaign:", campaignId);

        const res = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/view`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();

        console.log("Fetched campaign data:", data);

        if (data.success) {
          const allRecipients = data.data.campaign.recipients || [];

          // ✅ Only show recipients that were actually sent (sent or completed)
          const sentRecipients = allRecipients.filter(
            (r) => r.status === "sent" || r.status === "completed"
          );

          console.log(
            `Recipients: total=${allRecipients.length}, sent/completed=${sentRecipients.length}`
          );

          setRecipients(sentRecipients);
          setFilteredRecipients(sentRecipients);
        } else {
          console.error("Failed to load recipients:", data);
        }

        setLoading(false);
      } catch (err) {
        console.error("Failed to load recipients", err);
        setLoading(false);
      }
    };

    if (campaignId) {
      fetchRecipients();
    }
  }, [campaignId]);

  // Search filter
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredRecipients(recipients);
      return;
    }
    const term = searchTerm.toLowerCase();
    setFilteredRecipients(
      recipients.filter((r) => r.email.toLowerCase().includes(term))
    );
  }, [searchTerm, recipients]);

  // Toggle single checkbox
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allFilteredSelected =
    filteredRecipients.length > 0 &&
    filteredRecipients.every((r) => selectedIds.has(r.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredRecipients.forEach((r) => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredRecipients.forEach((r) => next.add(r.id));
        return next;
      });
    }
  };


// Bulk delete selected
const handleDeleteSelected = () => {
  if (selectedIds.size === 0) return;
  const count = selectedIds.size;
  setDeletedIds((prev) => new Set([...prev, ...selectedIds]));
  setRecipients((prev) => prev.filter((r) => !selectedIds.has(r.id)));
  setFilteredRecipients((prev) => prev.filter((r) => !selectedIds.has(r.id)));
  setSelectedIds(new Set());
  setDeleteMessage(`Deleted ${count} recipient${count > 1 ? "s" : ""}`);
  setTimeout(() => setDeleteMessage(""), 3000);
};

// Delete single
const handleDelete = (recipientId) => {
  const recipient = recipients.find((r) => r.id === recipientId);
  setDeletedIds((prev) => new Set(prev).add(recipientId));
  setRecipients((prev) => prev.filter((r) => r.id !== recipientId));
  setFilteredRecipients((prev) => prev.filter((r) => r.id !== recipientId));
  setSelectedIds((prev) => {
    const next = new Set(prev);
    next.delete(recipientId);
    return next;
  });
  setDeleteMessage(`Deleted: ${recipient?.email || "Recipient"}`);
  setTimeout(() => setDeleteMessage(""), 3000);
};

// Save = commit the deletions
const handleSave = async () => {
  if (deletedIds.size === 0) {
    onUpdated();
    return;
  }
  try {
    setSaving(true);
    const token = localStorage.getItem("token");

    const payload = {
      campaignId: Number(campaignId),
      deletedRecipientIds: Array.from(deletedIds),
    };

    const response = await fetch(`${API_BASE_URL}/api/campaigns/followup/update-recipients`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.success) {
      setDeletedIds(new Set());
      onUpdated();
    } else {
      alert(`Failed to save recipients: ${data.message || "Please try again."}`);
    }
  } catch (err) {
    console.error("Save error:", err);
    alert("An error occurred while saving recipients. Check console for details.");
  } finally {
    setSaving(false);
  }
};

  return (
    /* ── Backdrop ── */
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      {/* ── Modal Shell ── */}
      <div className="bg-white rounded-2xl w-[90%] max-w-2xl min-h-[500px] max-h-[90vh] flex flex-col shadow-2xl border-2 border-emerald-200 overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-5 border-b-2 border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl">
              <Mail className="text-emerald-600" size={20} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-emerald-700">Update Recipients</h3>
              <p className="text-xs text-emerald-500 font-medium mt-0.5">
                Showing only successfully sent emails
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Search Bar ── */}
        <div className="px-6 pt-4">
          <div className="flex items-center gap-2 px-4 py-3 border-2 border-emerald-300 rounded-xl bg-emerald-50/60 focus-within:ring-2 focus-within:ring-emerald-400 transition-all">
            <Search size={17} className="text-emerald-500 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search recipients by email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-sm text-slate-800 placeholder-emerald-400 font-medium"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {/* ── Delete Message Toast ── */}
        {deleteMessage && (
          <div className="mx-6 mt-3 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-medium">
            <UserX size={15} />
            <span>{deleteMessage}</span>
          </div>
        )}

        {/* ── Bulk Action Bar ── */}
        {selectedIds.size > 0 && (
          <div className="mx-6 mt-3 flex items-center justify-between px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
            <span className="text-sm font-semibold text-blue-700">
              {selectedIds.size} selected
            </span>
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-all shadow-sm shadow-red-300"
            >
              <Trash2 size={13} />
              Delete Selected ({selectedIds.size})
            </button>
          </div>
        )}

        {/* ── Count Line ── */}
        <div className="px-6 pt-3 pb-1 text-xs text-slate-400 font-semibold uppercase tracking-wide">
          {loading ? "Loading..." : `Showing ${filteredRecipients.length} of ${recipients.length} sent recipients`}
        </div>

        {/* ── Body ── */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400 py-16">
            <Loader2 size={36} className="animate-spin text-emerald-500" />
            <p className="text-sm font-medium">Loading recipients...</p>
          </div>
        ) : recipients.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 py-16">
            <UserX size={48} className="text-slate-300" />
            <p className="text-sm font-medium">No sent recipients found</p>
            <p className="text-xs text-slate-300">Only recipients with "sent" or "completed" status appear here</p>
          </div>
        ) : filteredRecipients.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 py-16">
            <Search size={48} className="text-slate-300" />
            <p className="text-sm font-medium">No recipients match your search</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 pb-2 min-h-[200px] max-h-[380px]">
            {/* Select All Row */}
            <div className="flex items-center py-3 border-b-2 border-emerald-100 bg-white sticky top-0 z-10">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                  {allFilteredSelected ? "Deselect All" : "Select All"}
                  {filteredRecipients.length !== recipients.length
                    ? ` (${filteredRecipients.length} visible)`
                    : ` (${recipients.length})`}
                </span>
              </label>
            </div>

            {/* Recipient Rows */}
            {filteredRecipients.map((r) => {
              const isSelected = selectedIds.has(r.id);
              return (
                <div
                  key={r.id}
                  className={`flex items-center justify-between py-3.5 px-3 border-b border-emerald-50 rounded-lg transition-all ${
                    isSelected
                      ? "bg-blue-50 border-l-4 border-l-blue-400"
                      : "hover:bg-emerald-50/40 border-l-4 border-l-transparent"
                  }`}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(r.id)}
                    className="w-4 h-4 accent-blue-500 cursor-pointer flex-shrink-0 mr-3"
                  />

                  {/* Email + Status */}
                  <div className="flex flex-col gap-1 flex-1">
                    <span className="text-sm font-semibold text-slate-800">{r.email}</span>
                    {r.status && (
                      <span
                        className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded uppercase w-fit tracking-wide ${
                          r.status === "sent"
                            ? "bg-emerald-100 text-emerald-700"
                            : r.status === "completed"
                            ? "bg-teal-100 text-teal-700"
                            : r.status === "failed"
                            ? "bg-red-100 text-red-700"
                            : "bg-indigo-100 text-indigo-700"
                        }`}
                      >
                        {r.status === "sent" || r.status === "completed" ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 size={9} />
                            {r.status}
                          </span>
                        ) : (
                          r.status
                        )}
                      </span>
                    )}
                  </div>

                  {/* Delete Button */}
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg ml-3 flex-shrink-0 transition-all shadow-sm shadow-red-200 hover:scale-105"
                  >
                    <Trash2 size={13} />
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t-2 border-emerald-100 bg-gradient-to-r from-slate-50 to-emerald-50">
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-bold transition-all"
          >
            <X size={16} />
            Cancel
          </button>

          <button
            onClick={handleSave}
            disabled={saving || recipients.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:shadow-lg hover:shadow-emerald-500/30 hover:scale-105 text-white text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save size={16} />
                Save Recipients ({recipients.length})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}