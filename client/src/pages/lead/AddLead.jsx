// client/src/pages/lead/AddLead.jsx
import React, { useEffect, useState } from "react";
import { ChevronLeft, X, Loader2, Plus } from "lucide-react";
import { api } from "../utils/api";
import { toast } from "react-hot-toast";
import DOMPurify from "dompurify";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function AddLeadModal({ open, onClose, message, conversation }) {
  const [loading, setLoading] = useState(false);

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
  if (open && message) {
    const bodyText = message.bodyHtml
      ? DOMPurify.sanitize(message.bodyHtml, { ALLOWED_TAGS: [] })
      : message.body || "";

    setForm((prev) => ({
      ...prev,
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

      // manual
      website: "",
    }));
  }
}, [open, message]);



  if (!open || !message) return null;

  // ================= SAVE HANDLER =================
const handleSave = async () => {
  // ================= FRONTEND VALIDATION =================
  if (!form.clientEmail?.trim()) {
    toast.error("Client Email is required");
    return;
  }

  if (!form.leadEmail?.trim()) {
    toast.error("Lead Email is required");
    return;
  }

  if (!form.subject?.trim()) {
    toast.error("Subject is required");
    return;
  }

  if (!form.leadType) {
    toast.error("Lead Type is required");
    return;
  }

  if (!form.country?.trim()) {
    toast.error("Country is required");
    return;
  }

  if (!form.leadLink?.trim()) {
    toast.error("Lead Type Link is required");
    return;
  }

  if (!form.website?.trim() && !form.phone?.trim()) {
    toast.error("Website or Phone Number is required");
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

    const res = await api.post("/api/leads/create-from-inbox", payload);

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
    "w-full px-3 py-2 border rounded-lg bg-white focus:ring-1 focus:ring-blue-400";

  const isFormInvalid =
    !form.clientEmail?.trim() ||
    !form.leadEmail?.trim() ||
    !form.subject?.trim() ||
    !form.leadType ||
    !form.country?.trim() ||
    !form.leadLink?.trim() ||
    (!form.website?.trim() && !form.phone?.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 mt-20">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl h-[95vh] flex flex-col overflow-hidden">
        {/* ================= HEADER ================= */}
        <div className="border-b px-6 py-4 bg-gray-50 flex justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-semibold">Add Lead</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ================= BODY ================= */}
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

            <div>
              <label className="text-sm font-medium">Lead Type</label>
              <select
                className={input}
                value={form.leadType}
                onChange={(e) =>
                  setForm({ ...form, leadType: e.target.value })
                }
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
                value={form.ccEmails}
                onChange={(e) =>
                  setForm({ ...form, ccEmails: e.target.value })
                }
              />
            </div>

            <div>
              <label className="text-sm font-medium">Phone Number</label>
              <input
                className={input}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Client Website</label>
              <input
                className={input}
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Lead Type Link</label>
              <input
                className={input}
                value={form.leadLink}
                onChange={(e) => setForm({ ...form, leadLink: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Country</label>
              <input
                className={input}
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
              />
            </div>

            {/* <div>
              <label className="text-sm font-medium">Contact Date</label>
              <input
                type="date"
                className={input}
                value={form.contactDate}
                onChange={(e) =>
                  setForm({ ...form, contactDate: e.target.value })
                }
              />
            </div> */}
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
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"}
            `}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Saving..." : "Save Lead"}
          </button>
        </div>
      </div>
    </div>
  );
}