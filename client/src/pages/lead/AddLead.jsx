// client/src/pages/lead/AddLead.jsx
import React, { useEffect, useState } from "react";
import { ChevronLeft, X, Loader2, Plus } from "lucide-react";
import { api } from "../utils/api";
import { toast } from "react-hot-toast";
import DOMPurify from "dompurify";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const initialFormState = {
  clientName: "",
  clientEmail: "",
  leadEmail: "",
  ccEmails: "",
  leadType: "ASSOCIATION",
  attendeesCount: "",
  website: "",
  leadLink: "",
  phone: "",
  country: "",
  contactDate: "",
  subject: "",
  emailPitch: "",
};
export default function AddLeadModal({ open, onClose, message, conversation }) {
  const [loading, setLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [attendeesCount, setAttendeesCount] = useState("");

  // ================= FORM STATE =================
  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    leadEmail: "",
    ccEmails: "",

    leadType: "ASSOCIATION",

    website: "",
    leadLink: "",
    phone: "",
    country: "",
    contactDate: "",

    subject: "",
    emailPitch: "",
  });


  // ================= EXTRACTORS =================

// Extract phone number
const extractPhone = (text = "") => {
  if (!text) return "";

  // Remove everything except digits
  const digits = text.replace(/\D/g, "");

  // ✅ ONLY accept exactly 10 digits
  if (digits.length === 10) {
    // Format nicely: 262-244-7429
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // ❌ If more or less than 10 digits → ignore
  return "";
};




// Extract country (basic)
const extractCountry = (text = "") => {
  if (!text) return "";

  // US ZIP code detection (12345 or 12345-6789)
  const usZipRegex = /\b\d{5}(-\d{4})?\b/;

  if (usZipRegex.test(text)) {
    return "United States";
  }

  // Fallback keyword detection
  const countries = [
    "United States",
    "USA",
    "India",
    "Canada",
    "United Kingdom",
    "UK",
    "Australia",
  ];

  const found = countries.find((c) =>
    text.toLowerCase().includes(c.toLowerCase())
  );

  return found || "";
};


  // ================= PREFILL FROM EMAIL =================
useEffect(() => {
  if (open) {
    if (message) {
      // Prefill from message
      const bodyText = message.bodyHtml
        ? DOMPurify.sanitize(message.bodyHtml, { ALLOWED_TAGS: [] })
        : message.body || "";

      setForm({
        clientName: message.fromName || "",
        clientEmail: message.fromEmail || "",
        leadEmail: message.toEmail || "",

        ccEmails: [message.ccEmail, message.bccEmail]
          .filter(Boolean)
          .join(", "),

        subject: message.subject || "",
        emailPitch: message.bodyHtml || message.body || "",

        // ✅ FIXED EXTRACTION
        phone: extractPhone(bodyText),
        country: extractCountry(bodyText),

        // Reset to defaults
        leadType: "ASSOCIATION",
        attendeesCount: "",
        website: "",
        leadLink: "",
        contactDate: "",
      });
    } else {
      // No message - reset to initial state
      setForm(initialFormState);
    }
  }
}, [open, message]);



  if (!open || !message) return null;

  // ================= SAVE HANDLER =================
const handleSave = async () => {
  // ================= COMPREHENSIVE VALIDATION =================
  
  // 1. Email validations
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!form.clientEmail?.trim()) {
    toast.error("Please enter Client Email");
    return;
  }
  
  if (!emailRegex.test(form.clientEmail.trim())) {
    toast.error("Please enter a valid Client Email");
    return;
  }

  if (!form.leadEmail?.trim()) {
    toast.error("Please enter Lead Email");
    return;
  }
  
  if (!emailRegex.test(form.leadEmail.trim())) {
    toast.error("Please enter a valid Lead Email");
    return;
  }

  // 2. CC Emails validation (if provided)
  if (form.ccEmails?.trim()) {
    const ccEmails = form.ccEmails.split(',').map(e => e.trim());
    for (const email of ccEmails) {
      if (!emailRegex.test(email)) {
        toast.error(`Please enter valid CC Email: ${email}`);
        return;
      }
    }
  }

  // 3. Subject validation
  if (!form.subject?.trim()) {
    toast.error("Please enter Subject");
    return;
  }

  // 4. Lead Type validation
  if (!form.leadType) {
    toast.error("Please select Lead Type");
    return;
  }

  // 5. Attendees Count validation (if ATTENDEES lead type)
  if (form.leadType === "ATTENDEES") {
    if (!form.attendeesCount || form.attendeesCount === "" || Number(form.attendeesCount) <= 0) {
      toast.error("Please enter Attendees Count for Attendees Lead");
      return;
    }
  }

  // 6. Phone Number validation (if provided)
  if (form.phone?.trim()) {
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      toast.error("Please enter a valid Phone Number (at least 10 digits)");
      return;
    }
  }

  // 7. Country validation
  if (!form.country?.trim()) {
    toast.error("Please select Country");
    return;
  }

  // 8. Website validation (must end with domain extension)
  const domainRegex = /\.[a-zA-Z]{2,}$/;
  
  if (form.website?.trim()) {
    if (!domainRegex.test(form.website.trim())) {
      toast.error("Please enter a valid Website URL (e.g., example.com)");
      return;
    }
  }

  // 9. Lead Type Link validation (must end with domain extension)
  if (!form.leadLink?.trim()) {
    toast.error("Please enter Lead Type Link");
    return;
  }
  
  if (!domainRegex.test(form.leadLink.trim())) {
    toast.error("Please enter a valid Lead Type Link (e.g., example.com)");
    return;
  }

  // 10. At least Website OR Phone required
  if (!form.website?.trim() && !form.phone?.trim()) {
    toast.error("Please enter either Website or Phone Number");
    return;
  }

  try {
    setLoading(true);

    const sentFormatted = message?.sentAt
      ? new Date(message.sentAt).toLocaleString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    const headerText = `From: ${form.clientEmail}
Sent: ${sentFormatted}
To: ${form.leadEmail}
Subject: ${form.subject}`;

    // ================= PAYLOAD =================
  const payload = {
  // ===== CORE =====
  email: form.leadEmail.trim(),                // Lead email (main)
  name: form.clientName?.trim() || null,
  subject: form.subject.trim(),
  attendeesCount: form.attendeesCount && form.attendeesCount !== "" ? Number(form.attendeesCount) : null, // ✅ send as number or null
  // ===== EMAIL MAPPING (THIS FIXES toEmail ISSUE) =====
  fromName: form.clientName?.trim() || null,
  fromEmail: form.clientEmail.trim(),          // ✅ Client → FROM
  toEmail: form.leadEmail.trim(),               // ✅ Lead → TO
  ccEmail: form.ccEmails?.trim() || null,
  bccEmail: null,

  // ===== META =====
  sentAt: message?.sentAt || null,

  // ===== LEAD DETAILS =====
  leadType: form.leadType,
  phone: form.phone?.trim() || null,
  country: form.country?.trim() || null,       // ✅ safe
  website: form.website?.trim() || null,
  leadLink: form.leadLink?.trim() || null,
  contactDate: form.contactDate || null,
  emailPitch: form.emailPitch || null,

  // ===== CONVERSATION =====
  headerText,
  conversationId: conversation?.conversationId || null,
  totalMessages: 1,

  // ❗ Prisma field is `thread Json?` NOT `fullConversation`
    thread: [
      {
        fromEmail: form.clientEmail.trim(),
        toEmail: form.leadEmail.trim(),
        subject: form.subject.trim(),
        sentAt: message?.sentAt || null,
        body: form.emailPitch || null,
      },
    ],
  };

    console.log("📤 Sending payload:", payload);

    const res = await api.post(`${API_BASE_URL}/api/leads/create-from-inbox`, payload);

    console.log("📥 Response:", res.data);

    // ================= SUCCESS (ONLY NEW LEAD) =================
    alert(res.data.message || "Lead created successfully");
    onClose(); // close after OK


    // ✅ close ONLY on success
    setTimeout(() => {
      onClose();
    }, 1500);

  } catch (err) {
    console.error("❌ Save lead error:", err);

    // ================= DUPLICATE LEAD =================
    if (err.response?.status === 409) {
      alert(err.response.data.message);
      return;
    }


    // ================= OTHER ERRORS =================
    if (err.response?.data?.message) {
      toast.error(`❌ ${err.response.data.message}`, {
        duration: 4000,
        position: "top-center",
      });
    } else if (err.code === "ERR_NETWORK") {
      toast.error(
        "❌ Cannot connect to server. Please check if backend is running.",
        { duration: 5000, position: "top-center" }
      );
    } else if (err.response?.status === 401) {
      toast.error("❌ Session expired. Please login again.", {
        duration: 4000,
        position: "top-center",
      });
    } else if (err.response?.status === 500) {
      toast.error("❌ Server error. Please check backend logs.", {
        duration: 4000,
        position: "top-center",
      });
    } else {
      toast.error("❌ Something went wrong. Please try again.", {
        duration: 4000,
        position: "top-center",
      });
    }
  } finally {
    setLoading(false);
  }
};


  // ================= INPUT UI =================
  const input =
    "w-full px-3 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-green-400 focus:border-green-400 outline-none";

  const isFormInvalid =
    !form.clientEmail?.trim() ||
    !form.leadEmail?.trim() ||
    !form.subject?.trim() ||
    !form.leadType ||
    !form.country?.trim() ||
    !form.leadLink?.trim() ||
    (!form.website?.trim() && !form.phone?.trim()) ||
    (form.leadType === "ATTENDEES" && (!form.attendeesCount || Number(form.attendeesCount) <= 0));

  return (
    <div className={`fixed z-50 ${
      isMinimized 
        ? 'bottom-0 right-4' 
        : 'inset-0 flex items-center justify-center bg-black/50 mt-20'
    }`}>
      <div 
        className={`bg-white shadow-xl flex flex-col overflow-hidden transition-all duration-300 ${
          isMinimized 
            ? 'w-[280px] rounded-t-lg' 
            : 'w-full max-w-5xl h-[95vh] rounded-xl'
        }`}
      >
        {/* ================= HEADER ================= */}
        <div className={`px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 text-white flex justify-between items-center ${!isMinimized ? 'border-b border-green-700' : ''}`}>
          <div className="flex items-center gap-3">
            {!isMinimized && (
              <button onClick={onClose} className="p-2 hover:bg-green-700 rounded-lg transition-colors">
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <h3 className={`font-semibold ${isMinimized ? 'text-sm' : 'text-lg'}`}>Add Lead</h3>
          </div>
          <div className="flex items-center gap-1">
            {isMinimized ? (
              <>
                {/* Large Restore Button when minimized */}
                <button 
                  onClick={() => setIsMinimized(false)}
                  className="p-2 px-3 hover:bg-green-700 rounded transition-colors border border-white/30"
                  title="Restore"
                >
                  <svg 
                    width="18" 
                    height="18" 
                    viewBox="0 0 16 16" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="1.5"
                  >
                    <rect x="3" y="3" width="10" height="10" />
                  </svg>
                </button>
                {/* Close Button */}
                <button onClick={onClose} className="p-2 hover:bg-green-700 rounded transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </>
            ) : (
              <>
                {/* Small Minimize Button when normal */}
                <button 
                  onClick={() => setIsMinimized(true)}
                  className="p-1.5 hover:bg-green-700 rounded transition-colors"
                  title="Minimize"
                >
                  <svg 
                    width="14" 
                    height="14" 
                    viewBox="0 0 16 16" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2"
                  >
                    <line x1="4" y1="8" x2="12" y2="8" />
                  </svg>
                </button>
                
                {/* Small Close Button */}
                <button onClick={onClose} className="p-1.5 hover:bg-green-700 rounded transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* ================= BODY ================= */}
        {!isMinimized && (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* BASIC INFO */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Client Name</label>
              <input
                className={input}
                value={form.clientName}
                onChange={(e) =>
                  setForm({ ...form, clientName: e.target.value })
                }
              />
            </div>

         <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">
            Lead Type
          </label>

          <select
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm
                      focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.leadType}
            onChange={(e) => {
              const value = e.target.value;

              setForm({
                ...form,
                leadType: value,
                attendeesCount:
                  value === "ATTENDEES" ? form.attendeesCount : "",
              });
            }}
          >
            <option value="ASSOCIATION">Association Lead</option>
            <option value="ATTENDEES">Attendees Lead</option>
            <option value="INDUSTRY">Industry Lead</option>
          </select>
        </div>


            <div>
              <label className="text-sm font-medium">Client Email</label>
              <input className={input} value={form.clientEmail} disabled />
            </div>

            <div>
              <label className="text-sm font-medium">Lead Email</label>
              <input className={input} value={form.leadEmail} disabled />
            </div>

            <div>
              <label className="text-sm font-medium">CC Emails</label>
              <input
                className={input}
                placeholder="email@example.com, email2@example.com"
                value={form.ccEmails}
                onChange={(e) =>
                  setForm({ ...form, ccEmails: e.target.value })
                }
              />
              <p className="text-xs text-gray-500 mt-1">Separate multiple emails with commas</p>
            </div>

            <div>
              <label className="text-sm font-medium">Phone Number</label>
              <input
                type="tel"
                className={input}
                placeholder="123-456-7890"
                value={form.phone}
                onChange={(e) => {
                  // Allow only numbers, spaces, hyphens, and parentheses
                  const value = e.target.value.replace(/[^\d\s\-()]/g, '');
                  setForm({ ...form, phone: value });
                }}
              />
              <p className="text-xs text-gray-500 mt-1">Enter at least 10 digits</p>
            </div>

            <div>
              <label className="text-sm font-medium">Client Website</label>
              <input
                className={input}
                placeholder="example.com"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-1">Must end with .com, .org, etc.</p>
            </div>

            <div>
              <label className="text-sm font-medium">Lead Type Link <span className="text-red-500">*</span></label>
              <input
                className={input}
                placeholder="example.com"
                value={form.leadLink}
                onChange={(e) => setForm({ ...form, leadLink: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-1">Required. Must end with .com, .org, etc.</p>
            </div>

            <div>
              <label className="text-sm font-medium">Country <span className="text-red-500">*</span></label>
              <select
                className={input}
                value={form.country === "United States" || form.country === "Canada" || form.country === "United Kingdom" || form.country === "Australia" || form.country === "USA" || form.country === "UK" ? form.country : "custom"}
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    setForm({ ...form, country: "" });
                  } else {
                    setForm({ ...form, country: e.target.value });
                  }
                }}
              >
                <option value="">Select Country</option>
                <option value="United States">United States</option>
                <option value="Canada">Canada</option>
                <option value="United Kingdom">United Kingdom</option>
                <option value="Australia">Australia</option>
                <option value="custom">Other (Type manually)</option>
              </select>
              
              {form.country !== "United States" && 
               form.country !== "Canada" && 
               form.country !== "United Kingdom" && 
               form.country !== "Australia" && 
               form.country !== "" && (
                <input
                  className={`${input} mt-2`}
                  placeholder="Enter country name"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              )}
            </div>

            {form.leadType === "ATTENDEES" && (
              <div>
                <label className="text-sm font-medium">Attendees Count <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min="1"
                  placeholder="Enter number of attendees"
                  className={`${input}`}
                  value={form.attendeesCount}
                  onChange={(e) =>
                    setForm({ ...form, attendeesCount: e.target.value })
                  }
                />
                <p className="text-xs text-gray-500 mt-1">Required for Attendees Lead</p>
              </div>
            )}


          </div>

          {/* SUBJECT */}
          <div>
            <label className="text-sm font-medium">Subject</label>
            <input
              className={input}
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </div>

          {/* EMAIL PITCH */}
          <div>
            <label className="text-sm font-medium mb-1 block">
              Email Pitch
            </label>
            <div
              contentEditable
              className="border rounded-lg p-4 min-h-[200px]"
              onInput={(e) =>
                setForm({
                  ...form,
                  emailPitch: e.currentTarget.innerHTML,
                })
              }
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(form.emailPitch),
              }}
            />
          </div>
        </div>

        {/* ================= FOOTER ================= */}
        <div className="border-t px-6 py-4 bg-gray-50 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || isFormInvalid}
            className={`px-6 py-2 rounded-lg flex items-center gap-2 transition-colors
              ${loading || isFormInvalid
                ? "bg-gray-400 cursor-not-allowed text-white"
                : "bg-green-600 hover:bg-green-700 text-white"}
            `}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Saving..." : "Save Lead"}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}