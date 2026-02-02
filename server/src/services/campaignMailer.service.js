import nodemailer from "nodemailer";
import prisma from "../prismaClient.js";
import { decrypt } from "../utils/crypto.js";
/* ------------------ helpers ------------------ */

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function distribute(items, total) {
  const result = [];
  let index = 0;

  for (let i = 0; i < total; i++) {
    result.push(items[index % items.length]);
    index++;
  }

  return shuffle(result);
}

function buildFollowupHtml({
  followUpBody,
  originalBody,
  from,
  to,
  sentAt,
  subject
}) {
  return `
    <div style="font-size:14px; line-height:1.6; color:#000;">
      
      <!-- Follow-up (top) -->
      <div>
        ${followUpBody}
      </div>

      <br />
      <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;" />

      <!-- Thread header -->
      <div style="font-size:14px; line-height:1.5;">
        <b>From:</b> ${from}<br/>
        <b>Sent:</b> ${sentAt}<br/>
        <b>To:</b> ${to}<br/>
        <b>Subject:</b> ${subject}
      </div>

      <br />

      <!-- Previous message -->
      <blockquote style="
        margin:0;
        padding-left:12px;
        border-left:2px solid #ccc;
        font-size:14px;
        line-height:1.6;
        color:#000;
      ">
        ${originalBody}
      </blockquote>

    </div>
  `;
}

function buildSignature(account) {
  const name =
    account.senderName ||
    account.email?.split("@")[0] ||
    "Sender";

  return `
    <div style="font-size:15px; line-height:1.6; color:#000; font-family:Calibri, Arial, sans-serif;">
    <b>
      <br/>
      Regards,<br/>
      ${name} - Marketing Analyst</b>
    </div>
  `;
}


function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 🔥 Default limits (can be overridden by campaign.customLimits)
const SAFE_LIMITS = {
  gmail: 50,
  gsuite: 80,
  rediff: 40,
  amazon: 60,
  custom: 60
};

function getLimit(provider = "", accountId = null, customLimits = {}) {
  // 🔥 Check custom limits first
  if (accountId && customLimits[accountId]) {
    return customLimits[accountId];
  }
  
  const key = provider.toLowerCase();
  return SAFE_LIMITS[key] || SAFE_LIMITS.custom;
}

function getDomainLabel(email = "") {
  const domain = email.split("@")[1]?.toLowerCase() || "";

  // common providers
  if (domain.includes("gmail")) return "gmail";
  if (domain.includes("yahoo")) return "yahoo";
  if (domain.includes("outlook") || domain.includes("hotmail")) return "outlook";

  // company domains: bouncecure.com → bouncecure
  return domain.split(".")[0] || "client";
}


/* ------------------ main sender with continuous sending ------------------ */

export async function sendBulkCampaign(campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { recipients: true },
  });

  if (!campaign) throw new Error("Campaign not found");

  // 🔥 Load custom limits if they exist
  let customLimits = {};
  if (campaign.customLimits) {
    try {
      customLimits = JSON.parse(campaign.customLimits);
    } catch (err) {
      console.error("Failed to parse custom limits:", err);
    }
  }

  // ---------------- subjects ----------------
  let subjects;
  try {
    subjects = JSON.parse(campaign.subject || "[]");
  } catch {
    subjects = [campaign.subject];
  }
  if (!subjects.length) throw new Error("Subjects missing");

  // ---------------- pitches ----------------
  let pitchIds;
  try {
    pitchIds = JSON.parse(campaign.pitchIds || "[]");
  } catch {
    pitchIds = [];
  }

  let pitchBodies = [];

  if (pitchIds.length) {
    const pitches = await prisma.pitchTemplate.findMany({
      where: { id: { in: pitchIds } }
    });


    pitchBodies = pitches.map(p => p.bodyHtml).filter(Boolean);
  }

  // ---------------- recipients ----------------
  const recipients = campaign.recipients.filter(r => r.status === "pending");
  if (!recipients.length) {
    console.log("No pending recipients, marking campaign as completed");
    await updateCampaignStatus(campaignId);
    return;
  }

  // ---------------- original body for followup ----------------
  let originalBodyHtml = "";
  if (campaign.sendType === "followup" && campaign.parentCampaignId) {
    const baseCampaign = await prisma.campaign.findUnique({
      where: { id: campaign.parentCampaignId }
    });
    originalBodyHtml = baseCampaign?.bodyHtml || "";
  }

  // ============================================================
  // ================= FOLLOW-UP FLOW ============================
  // ============================================================
  if (campaign.sendType === "followup") {

    const subjectPlan = distribute(subjects, recipients.length);

    const pitchPlan = pitchBodies.length
      ? distribute(pitchBodies, recipients.length)
      : distribute([campaign.bodyHtml], recipients.length);


    const grouped = {};
    for (const r of recipients) {
      if (!r.accountId) continue;
      if (!grouped[r.accountId]) grouped[r.accountId] = [];
      grouped[r.accountId].push(r);
    }

    for (const [accountId, group] of Object.entries(grouped)) {

      const account = await prisma.emailAccount.findUnique({
        where: { id: Number(accountId) }
      });
      if (!account) continue;

      // 🔥 Get the limit for this account (1 hour window now)
      const limit = getLimit(account.provider, account.id, customLimits);
      const delayPerEmail = (60 * 60 * 1000) / limit; // 1 hour window

      let smtpPassword = account.encryptedPass;

      if (typeof smtpPassword === "string" && smtpPassword.includes(":")) {
        smtpPassword = decrypt(smtpPassword);
      }

      const domain = (account.email.split("@")[1] || "localhost").toLowerCase();

      const transporter = nodemailer.createTransport({
        host: account.smtpHost,
        port: Number(account.smtpPort),
        secure: Number(account.smtpPort) === 465,

        name: domain,  

        auth: {
          user: account.smtpUser || account.email,
          pass: smtpPassword,
        },
        requireTLS: Number(account.smtpPort) === 587,
        tls: {
          rejectUnauthorized: false,
          minVersion: "TLSv1.2",
        },
      });

      const fromEmail = account.smtpUser || account.email;

      // 🔥 Send emails continuously within the 1-hour window
      for (const recipient of group) {
        try {
          const signature = buildSignature(account);

          let originalWithSignature =
            recipient.sentBodyHtml ||
            originalBodyHtml ||
            "";

          if (recipient.accountId) {
            const originalAccount = await prisma.emailAccount.findUnique({
              where: { id: recipient.accountId }
            });

            if (originalAccount) {
              const originalSignature = buildSignature(originalAccount);

              if (
                !originalBodyHtml.toLowerCase().includes("regards") &&
                !originalBodyHtml.toLowerCase().includes(originalAccount.senderName?.toLowerCase() || "")
              ) {
                originalWithSignature = originalBodyHtml + originalSignature;
              }
            }
          }

          const recipientIndex = recipients.findIndex(r => r.id === recipient.id);

          const rawSubject = subjectPlan[recipientIndex];
          const label = getDomainLabel(recipient.email);
          const subject = `${label} - ${rawSubject}`;

          const followUpBody = pitchPlan[recipientIndex] + signature;

          const html = buildFollowupHtml({
            followUpBody,
            originalBody: originalWithSignature,
            from: fromEmail,
            to: recipient.email,
            sentAt: new Date().toLocaleString(),
            subject
          });


          await transporter.sendMail({
            from: account.senderName
              ? `"${account.senderName}" <${fromEmail}>`
              : fromEmail,
            to: recipient.email,
            subject,
            html
          });

          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: {
              status: "sent",
              sentAt: new Date(),
              accountId: account.id,
              sentSubject: subject,
              sentBodyHtml: html,
              sentFromEmail: fromEmail
            }
          });

          console.log(`✅ Sent to ${recipient.email} (Account: ${account.email})`);

          // 🔥 Throttle based on the calculated delay
          await sleep(delayPerEmail);

        } catch (err) {
          console.error(`❌ Failed to send to ${recipient.email}:`, err.message);

          // mark recipient failed
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "failed", error: err.message }
          });

          // ⛔ IMPORTANT: pause campaign
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { status: "paused" }
          });

          console.log("Campaign paused due to error:", err.message);

          return; // stop sending safely
        }
      }
    }
  }

  // ============================================================
  // ================= NORMAL CAMPAIGN FLOW ======================
  // ============================================================
  else {

    let fromAccountIds;
    try {
      fromAccountIds = JSON.parse(campaign.fromAccountIds || "[]");
    } catch {
      fromAccountIds = [];
    }

    if (!fromAccountIds.length) throw new Error("From accounts missing");

    const subjectPlan = distribute(subjects, recipients.length);
    const fromPlan = distribute(fromAccountIds, recipients.length);

    const pitchPlan = pitchBodies.length
      ? distribute(pitchBodies, recipients.length)
      : null;

    // 🔥 NEW: Track sending progress per account to handle limits
    const accountSendCount = {};
    const accountLastSendTime = {};

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const rawSubject = subjectPlan[i];
      const label = getDomainLabel(recipient.email);
      const subject = `${label} - ${rawSubject}`;

      const accountId = fromPlan[i];

      try {
        const account = await prisma.emailAccount.findUnique({
          where: { id: accountId }
        });
        if (!account) continue;

        // 🔥 Get the limit for this account
        const limit = getLimit(account.provider, account.id, customLimits);
        const delayPerEmail = (60 * 60 * 1000) / limit; // 1 hour window

        // 🔥 Check if we need to wait for the next hour window
        if (!accountSendCount[accountId]) {
          accountSendCount[accountId] = 0;
          accountLastSendTime[accountId] = Date.now();
        }

        // If we've hit the limit, check if an hour has passed
        if (accountSendCount[accountId] >= limit) {
          const timeSinceFirstSend = Date.now() - accountLastSendTime[accountId];
          
          if (timeSinceFirstSend < 60 * 60 * 1000) {
            // Wait for the remainder of the hour
            const waitTime = (60 * 60 * 1000) - timeSinceFirstSend;
            console.log(`⏳ Account ${account.email} reached limit. Waiting ${Math.ceil(waitTime / 1000 / 60)} minutes...`);
            await sleep(waitTime);
          }
          
          // Reset counter for new hour
          accountSendCount[accountId] = 0;
          accountLastSendTime[accountId] = Date.now();
        }

        let smtpPassword = account.encryptedPass;

        if (typeof smtpPassword === "string" && smtpPassword.includes(":")) {
          smtpPassword = decrypt(smtpPassword);
        }

        const domain = (account.email.split("@")[1] || "localhost").toLowerCase();

        const transporter = nodemailer.createTransport({
          host: account.smtpHost,
          port: Number(account.smtpPort),
          secure: Number(account.smtpPort) === 465,

          name: domain,  

          auth: {
            user: account.smtpUser || account.email,
            pass: smtpPassword,
          },
          requireTLS: Number(account.smtpPort) === 587,
          tls: {
            rejectUnauthorized: false,
            minVersion: "TLSv1.2",
          },
        });

        const fromEmail = account.smtpUser || account.email;
        const signature = buildSignature(account);

        const body = pitchPlan ? pitchPlan[i] : campaign.bodyHtml;
        const html = `
          <div style="font-family:Calibri, Arial, sans-serif; font-size:14px; line-height:1.0; color:#000;">
            ${body}
            ${signature}
          </div>
        `;


        await transporter.sendMail({
          from: account.senderName
            ? `"${account.senderName}" <${fromEmail}>`
            : fromEmail,
          to: recipient.email,
          subject,
          html
        });

        // ✅ update progress
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "sent", sentAt: new Date(), accountId: account.id }
        });

        // 🔥 Increment send count
        accountSendCount[accountId]++;

        console.log(`✅ Sent ${accountSendCount[accountId]}/${limit} to ${recipient.email} (Account: ${account.email})`);

        // throttle per account
        await sleep(delayPerEmail);


      } catch (err) {
        console.error(`❌ Failed to send to ${recipient.email}:`, err.message);

        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "failed", error: err.message }
        });

        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: "paused" }
        });

        console.log("Campaign paused due to error:", err.message);

        return;
      }

    }
  }

  // 🔥 After sending all emails, update campaign status
  await updateCampaignStatus(campaignId);

  console.log(`✅ Campaign ${campaignId} completed all pending emails`);
}

// 🔥 Helper function to update campaign status based on recipients
async function updateCampaignStatus(campaignId) {
  const stats = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { status: true }
  });

  const counts = {
    sent: 0,
    failed: 0,
    pending: 0
  };

  for (const row of stats) {
    counts[row.status] = row._count.status;
  }

  let finalStatus = "completed";

  if (counts.sent === 0 && counts.failed > 0) {
    finalStatus = "failed";
  }
  else if (counts.sent > 0 && counts.failed > 0) {
    finalStatus = "completed_with_errors";
  }
  else if (counts.pending > 0) {
    finalStatus = "sending";
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: finalStatus },
  });

  console.log(`Campaign ${campaignId} status updated to:`, finalStatus);
}