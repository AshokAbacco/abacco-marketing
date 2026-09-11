// server/src/config/emailRetention.js
//
// Single source of truth for how long emails are kept.
//
// Every email has its OWN 7-day clock that starts when it arrived
// (EmailMessage.createdAt). There is no weekly "wipe everything" run:
// the purge job deletes only the rows whose own clock has run out.
//
//   Received Mon 10:15  → deleted shortly after next Mon 10:15
//   Received Tue 16:40  → deleted shortly after next Tue 16:40
//
// Used by:
//   • services/emailRetention.service.js  – the purge job
//   • services/imap.service.js            – first-sync window + skip old mail
//   • routes/inbox/inbox.js               – list queries never show expired mail
//
// Override with EMAIL_RETENTION_DAYS in .env (API and worker must match).

const parsed = Number(process.env.EMAIL_RETENTION_DAYS);

export const EMAIL_RETENTION_DAYS =
  Number.isFinite(parsed) && parsed > 0 ? parsed : 7;

export const EMAIL_RETENTION_MS = EMAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Folders that are never auto-deleted. Drafts are the user's unsent work,
// not received mail, so losing them after a week would be surprising.
export const RETENTION_EXEMPT_FOLDERS = ["draft"];

/** Any email that arrived before this moment has expired. */
export function retentionCutoff(now = Date.now()) {
  return new Date(now - EMAIL_RETENTION_MS);
}