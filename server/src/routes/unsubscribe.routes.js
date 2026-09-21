// src/routes/unsubscribe.routes.js
//
// PUBLIC (no login) unsubscribe endpoints, mounted at /u on the API origin.
//
//   GET  /u/:token   → confirmation page with a button (link scanners that
//                      pre-open links must not unsubscribe people)
//   POST /u/:token   → unsubscribes. Handles both the page's button and the
//                      RFC 8058 one-click request that Gmail/Yahoo send
//                      (body: List-Unsubscribe=One-Click).

import express from "express";
import {
  verifyUnsubscribeToken,
  suppressEmail,
  getSuppression,
  maskEmail,
  escapeHtml,
} from "../services/suppression.service.js";
import { simpleLimiter } from "../middlewares/rateLimit.js";

const router = express.Router();

const COMPANY = process.env.UNSUBSCRIBE_COMPANY_NAME || "our team";

router.use(simpleLimiter({ name: "unsub", max: 60, windowMs: 60_000 }));
router.use((req, res, next) => {
  // Never cache or index these pages.
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
});

function page(res, status, { title, message, form = "" }) {
  res.status(status).type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
         background:#f4f6f8; color:#1f2937; }
  .card { background:#fff; max-width:440px; width:calc(100% - 32px); padding:32px 28px;
          border-radius:14px; box-shadow:0 4px 24px rgba(0,0,0,.08); text-align:center; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { font-size:15px; line-height:1.55; margin:0 0 20px; color:#4b5563; }
  button { font-size:15px; font-weight:600; padding:12px 22px; border:0; border-radius:10px;
           background:#0f766e; color:#fff; cursor:pointer; }
  button:focus-visible { outline:3px solid #99f6e4; outline-offset:2px; }
  @media (prefers-color-scheme: dark) {
    body { background:#0f172a; color:#e5e7eb; }
    .card { background:#111827; box-shadow:none; }
    p { color:#9ca3af; }
  }
</style>
</head>
<body>
<main class="card">
  <h1>${escapeHtml(title)}</h1>
  <p>${message}</p>
  ${form}
</main>
</body>
</html>`);
}

const invalid = (res) =>
  page(res, 400, {
    title: "Link not valid",
    message: "This unsubscribe link is invalid or incomplete. Please reply to the email with “unsubscribe” and we will remove you.",
  });

router.get("/:token", async (req, res) => {
  const data = verifyUnsubscribeToken(req.params.token);
  if (!data) return invalid(res);

  try {
    const current = await getSuppression(data.email);
    if (current.suppressed) {
      return page(res, 200, {
        title: "You're unsubscribed",
        message: `${escapeHtml(maskEmail(data.email))} will not receive further emails from ${escapeHtml(COMPANY)}.`,
      });
    }
  } catch {
    /* fall through to the form — the POST will surface real errors */
  }

  return page(res, 200, {
    title: "Unsubscribe",
    message: `Stop receiving emails from ${escapeHtml(COMPANY)} at <strong>${escapeHtml(maskEmail(data.email))}</strong>?`,
    form: `<form method="post" action="">
      <input type="hidden" name="confirm" value="1">
      <button type="submit">Unsubscribe</button>
    </form>`,
  });
});

router.post("/:token", async (req, res) => {
  const data = verifyUnsubscribeToken(req.params.token);
  const oneClick = String(req.body?.["List-Unsubscribe"] || "").toLowerCase() === "one-click";

  if (!data) {
    return oneClick ? res.status(400).json({ success: false }) : invalid(res);
  }

  try {
    await suppressEmail({
      email: data.email,
      reason: "unsubscribe",
      source: oneClick ? "one_click" : "link",
      campaignId: data.campaignId,
    });
  } catch (err) {
    console.error("Unsubscribe failed:", err.message);
    if (oneClick) return res.status(503).json({ success: false });
    return page(res, 503, {
      title: "Something went wrong",
      message: "We couldn't process your request right now. Please try again in a minute.",
    });
  }

  if (oneClick) return res.status(200).json({ success: true });

  return page(res, 200, {
    title: "You're unsubscribed",
    message: `${escapeHtml(maskEmail(data.email))} has been removed. You won't receive further emails from ${escapeHtml(COMPANY)}.`,
  });
});

export default router;
