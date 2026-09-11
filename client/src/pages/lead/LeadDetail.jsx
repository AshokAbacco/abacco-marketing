import { X, Save, Mail, User, Calendar, Globe, Phone, FileText, Building2, MapPin } from "lucide-react";
import { useState, useEffect } from "react";
import DOMPurify from "dompurify";

export default function LeadDetail({ open, onClose, lead, onSave }) {
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({});
  const [messageBody, setMessageBody] = useState("");

  useEffect(() => {
    if (lead) {
      setForm(lead);
      setEditMode(lead._mode === "edit");

      const rawHtml = lead.thread?.[0]?.body || "";
      setMessageBody(htmlToText(rawHtml));
    }
  }, [lead]);

  if (!open || !lead) return null;

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSaveClick = () => {
    const safeHtml = `<div style="white-space: pre-wrap; font-family: Calibri, sans-serif; font-size: 11pt;">
      ${messageBody.replace(/\n/g, "<br/>")}
    </div>`;

    onSave({
      ...form,
      thread: [
        {
          ...(form.thread?.[0] || {}),
          body: safeHtml,
        },
      ],
    });
  };

  const htmlToText = (html) => {
    if (!html) return "";

    const div = document.createElement("div");
    div.innerHTML = html;

    div.querySelectorAll("br").forEach(br => br.replaceWith("\n"));

    return div.textContent || "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[95vh] overflow-hidden border border-sky-100 dark:border-sky-900">

        {/* Header */}
        <div className="border-b border-sky-100 dark:border-sky-900 px-8 py-6 bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-lg">
                <User className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                  {editMode ? "Edit Lead" : "Lead Details"}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {editMode ? "Update lead information" : "View lead information"}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-200"
            >
              <X className="w-6 h-6 text-slate-600 dark:text-slate-400" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto max-h-[calc(95vh-200px)]">
          <div className="p-8 space-y-8">

            {/* Basic Information Section */}
            <div className="bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/10 dark:to-blue-900/10 rounded-xl p-6 border border-sky-100 dark:border-sky-900">
              <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <Mail className="w-5 h-5 text-sky-600" />
                Email Information
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputField
                  label="From"
                  name="fromEmail"
                  value={form.fromEmail || ""}
                  disabled={!editMode}
                  onChange={handleChange}
                  icon={<Mail className="w-4 h-4" />}
                />

                <InputField
                  label="To"
                  name="toEmail"
                  value={form.toEmail || ""}
                  disabled={!editMode}
                  onChange={handleChange}
                  icon={<Mail className="w-4 h-4" />}
                />

                {form.ccEmail?.trim() && (
                  <InputField
                    label="CC"
                    name="ccEmail"
                    value={form.ccEmail}
                    disabled={!editMode}
                    onChange={handleChange}
                    icon={<Mail className="w-4 h-4" />}
                  />
                )}

                {form.bccEmail?.trim() && (
                  <InputField
                    label="BCC"
                    name="bccEmail"
                    value={form.bccEmail}
                    disabled={!editMode}
                    onChange={handleChange}
                    icon={<Mail className="w-4 h-4" />}
                  />
                )}
              </div>
            </div>

            {/* Lead Details Section */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 rounded-xl p-6 border border-blue-100 dark:border-blue-900">
              <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-blue-600" />
                Lead Information
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputField
                  label="Name"
                  name="name"
                  value={form.name || ""}
                  disabled={!editMode}
                  onChange={handleChange}
                  icon={<User className="w-4 h-4" />}
                />

                <InputField
                  label="Lead Email"
                  name="email"
                  value={form.email || ""}
                  disabled={!editMode}
                  onChange={handleChange}
                  icon={<Mail className="w-4 h-4" />}
                />

                <InputField
                  label="Phone"
                  name="phone"
                  value={form.phone || ""}
                  disabled={!editMode}
                  onChange={handleChange}
                  icon={<Phone className="w-4 h-4" />}
                />

                <InputField
                  label="Website"
                  name="website"
                  value={form.website || ""}
                  disabled={!editMode}
                  onChange={handleChange}
                  icon={<Globe className="w-4 h-4" />}
                />

                <InputField
                  label="Country"
                  name="country"
                  value={form.country || ""}
                  disabled={!editMode}
                  onChange={handleChange}
                  icon={<MapPin className="w-4 h-4" />}
                />

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-sky-600" />
                    Lead Type
                  </label>
                  <select
                    name="leadType"
                    value={form.leadType || "ASSOCIATION"}
                    disabled={!editMode}
                    onChange={handleChange}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all ${
                      editMode 
                        ? "bg-white dark:bg-slate-900 border-sky-200 dark:border-sky-800" 
                        : "bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 cursor-not-allowed"
                    }`}
                  >
                    <option value="ASSOCIATION">Association Lead</option>
                    <option value="ATTENDEES">Attendees Lead</option>
                    <option value="INDUSTRY">Industry Lead</option>
                  </select>
                </div>

                <InputField
                  label="Lead Link"
                  name="leadLink"
                  value={form.leadLink || ""}
                  disabled={!editMode}
                  onChange={handleChange}
                  icon={<Globe className="w-4 h-4" />}
                />

                <InputField
                  label="Contact Date"
                  name="contactDate"
                  type="date"
                  value={form.contactDate?.split('T')[0] || ""}
                  disabled={!editMode}
                  onChange={handleChange}
                  icon={<Calendar className="w-4 h-4" />}
                />
              </div>
            </div>

            {/* Subject Section */}
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/10 dark:to-pink-900/10 rounded-xl p-6 border border-purple-100 dark:border-purple-900">
              <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-purple-600" />
                Subject
              </h4>
              <InputField
                name="subject"
                value={form.subject || ""}
                disabled={!editMode}
                onChange={handleChange}
                placeholder="Email subject..."
              />
            </div>

            {/* Message Section */}
            <div className="bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/10 dark:to-yellow-900/10 rounded-xl p-6 border border-amber-100 dark:border-amber-900">
              <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-600" />
                Message Content
              </h4>
              <div
                className="border border-amber-200 dark:border-amber-800 rounded-xl bg-white dark:bg-slate-900 p-6 max-h-96 overflow-y-auto prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(lead.thread?.[0]?.body || "<p class='text-slate-400'>No message content</p>"),
                }}
              />
            </div>

            {/* Additional Info */}
            {form.sentAt && (
              <div className="bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-900/10 dark:to-sky-900/10 rounded-xl p-6 border border-blue-100 dark:border-blue-900">
                <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                  <Calendar className="w-5 h-5" />
                  <span className="font-medium">Sent Date:</span>
                  <span>{new Date(form.sentAt).toLocaleString()}</span>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-sky-100 dark:border-sky-900 px-8 py-6 bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-3 border-2 border-slate-300 dark:border-slate-600 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all duration-200"
          >
            {editMode ? "Cancel" : "Close"}
          </button>

          {editMode && (
            <button
              onClick={handleSaveClick}
              className="px-6 py-3 bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 hover:from-sky-700 hover:to-blue-700 transition-all duration-200 shadow-lg hover:shadow-sky-500/50"
            >
              <Save size={18} />
              Save Changes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function InputField({ label, icon, ...props }) {
  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
          {icon && <span className="text-sky-600">{icon}</span>}
          {label}
        </label>
      )}
      <input
        {...props}
        className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all ${
          props.disabled 
            ? "bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 cursor-not-allowed text-slate-600 dark:text-slate-400" 
            : "bg-white dark:bg-slate-900 border-sky-200 dark:border-sky-800 text-slate-900 dark:text-white"
        }`}
      />
    </div>
  );
}