// Shared client — a `new PrismaClient()` here opened a second connection pool.
import prisma from "../prismaClient.js";
import { syncLeadToCrm } from "../services/crm.service.js";

/**
 * Keep the CRM in step with leads (Phase 2). Never fails the lead request:
 * the lead is the user's primary action; CRM linking can be repeated by
 * scripts/migrateLeadsToCrm.js.
 */
async function syncLeadSafely(lead) {
  try {
    const result = await syncLeadToCrm(lead);
    return result?.contact?.id ?? null;
  } catch (err) {
    console.error(`CRM sync for lead ${lead.id} failed:`, err.message);
    return null;
  }
}

// ================= CREATE OR UPDATE LEAD FROM INBOX =================
export const createLeadFromInbox = async (req, res) => {
  try {
    const {
      email,
      name,
      subject,
      fromName,
      fromEmail,
      toEmail,
      ccEmail,
      bccEmail,
      phone,
      country,
      website,
      leadLink,
      contactDate,
      emailPitch,
      headerText,
      conversationId,
      totalMessages,
      thread,
      leadType,
      sentAt,
    } = req.body;

    // 🔒 STRICT duplicate check (NO UPDATE)
    const existingLead = await prisma.lead.findFirst({
      where: {
        fromEmail: fromEmail,
        userId: req.user.id,
      },
    });

    if (existingLead) {
      return res.status(409).json({
        success: false,
        message: "Duplicate lead: this From Email already exists",
      });
    }

    // ✅ ONLY CREATE

    const lead = await prisma.lead.create({
      data: {
        userId: req.user.id,
        email,
        name,
        subject,
        attendeesCount: req.body.attendeesCount,
        fromName,
        fromEmail,
        toEmail,
        ccEmail,
        bccEmail,

        phone,
        country,
        website,
        leadLink,
        contactDate,

        emailPitch,
        headerText,

        conversationId,
        totalMessages: totalMessages ?? 1,
        thread,

        leadType,
        sentAt,
      },
    });

    const contactId = await syncLeadSafely(lead);

    res.status(201).json({
      success: true,
      message: "Lead saved successfully",
      lead: { ...lead, contactId },
      contactId,
    });
  } catch (error) {
    if (error.code === "P2002") {
      // fromEmail is unique company-wide.
      return res.status(409).json({
        success: false,
        message:
          "This client is already a lead of another team member. Open it in CRM → Contacts.",
      });
    }
    console.error("❌ Save lead error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save lead",
    });
  }
};

// ================= GET ALL LEADS =================
export const getAllLeads = async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      where: {
        userId: req.user.id, // ✅ Add this
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      leads,
    });
  } catch (error) {
    console.error("Fetch leads error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch leads",
    });
  }
};

// ================= GET SINGLE LEAD (VIEW) =================
export const getLeadById = async (req, res) => {
  try {
    const id = Number(req.params.id);

    const lead = await prisma.lead.findUnique({
      where: {
        id: id,
        userId: req.user.id,
      },
    });

    if (!lead) {
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    }

    res.json({ success: true, lead });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch lead" });
  }
};

export const updateLead = async (req, res) => {
  try {
    const id = Number(req.params.id);

    const {
      name,
      email,
      subject,

      // Email fields
      fromName,
      fromEmail,
      toEmail,
      ccEmail,
      bccEmail,
      sentAt,

      // 🔥 NEW CRM fields
      leadType,
      phone,
      country,
      website,
      leadLink,
      contactDate,
      emailPitch,
    } = req.body;

    const updated = await prisma.lead.update({
      where: {
        id: id,
        userId: req.user.id, // ✅ Add this
      },
      data: {
        name,
        email,
        subject,
        attendeesCount: req.body.attendeesCount,

        fromName,
        fromEmail,
        toEmail,
        ccEmail,
        bccEmail,
        sentAt: sentAt ? new Date(sentAt) : null,

        // CRM fields
        leadType,
        phone,
        country,
        website,
        leadLink,
        contactDate: contactDate ? new Date(contactDate) : null,
        emailPitch,
      },
    });

    const contactId = await syncLeadSafely(updated);

    res.json({
      success: true,
      lead: { ...updated, contactId: contactId ?? updated.contactId },
    });
  } catch (error) {
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    }
    if (error.code === "P2002") {
      return res
        .status(409)
        .json({
          success: false,
          message: "Another lead already uses this From Email",
        });
    }
    console.error("Update lead error:", error);
    res.status(500).json({
      success: false,
      message: "Update failed",
    });
  }
};

// ================= DELETE LEAD =================
export const deleteLead = async (req, res) => {
  try {
    const id = Number(req.params.id);

    await prisma.lead.delete({
      where: {
        id: id,
        userId: req.user.id, // ✅ Add this
      },
    });

    res.json({ success: true, message: "Lead deleted" });
  } catch (error) {
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    }
    console.error("Delete error:", error);
    res.status(500).json({ success: false, message: "Delete failed" });
  }
};
