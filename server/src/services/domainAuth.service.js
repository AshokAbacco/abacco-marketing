// src/services/domainAuth.service.js
//
// Checks SPF, DKIM and DMARC for each sending domain (Phase 4).
//
// These DNS records tell receiving servers that your mail is genuine.
// Without them, cold email lands in spam far more often — and Gmail and
// Yahoo require them from bulk senders on their own domains.
//
// Free mailbox domains (gmail.com, yahoo.com …) are reported separately:
// you cannot change their DNS, and the provider signs those messages
// itself, so there is nothing to fix there.

import dns from "dns/promises";
import prisma from "../prismaClient.js";
import cache from "../utils/cache.js";

const FREE_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "ymail.com",
  "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com",
  "icloud.com", "me.com", "aol.com", "protonmail.com", "proton.me",
  "rediffmail.com", "zoho.com", "gmx.com", "mail.com", "yandex.com", "qq.com",
]);

// Common DKIM selectors, so a check works without configuration.
const DKIM_SELECTORS = ["google", "default", "selector1", "selector2", "s1", "s2", "k1", "mail", "dkim", "zoho", "smtp"];

const CACHE_KEY = "domainAuth";
const TTL_SECONDS = Number(process.env.DOMAIN_AUTH_TTL_SECONDS) || 6 * 3600;
const DNS_TIMEOUT_MS = Number(process.env.DNS_TIMEOUT_MS) || 5000;

const resolver = new dns.Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });

async function txt(name) {
  try {
    return (await resolver.resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

async function probeSelector(domain, selector) {
  const host = `${selector}._domainkey.${domain}`;
  const records = await txt(host);
  if (records.some((r) => /v=DKIM1|p=[A-Za-z0-9+/]/i.test(r))) return { ok: true, selector };
  try {
    const cname = await resolver.resolveCname(host);
    if (cname.length) return { ok: true, selector, via: cname[0] };
  } catch { /* not this selector */ }
  return null;
}

/** Probe the usual selectors in parallel (one slow lookup shouldn't stall the rest). */
async function hasDkim(domain) {
  const results = await Promise.all(DKIM_SELECTORS.map((sel) => probeSelector(domain, sel).catch(() => null)));
  return results.find(Boolean) || { ok: false, selector: null };
}

function checkSpf(records) {
  const spf = records.find((r) => /^v=spf1/i.test(r.trim()));
  if (!spf) return { ok: false, record: null, note: "No SPF record found" };
  const strict = /[-~]all\b/.test(spf);
  return {
    ok: true,
    record: spf.slice(0, 300),
    note: strict ? null : "SPF ends with +all or nothing — tighten it to ~all or -all",
  };
}

function checkDmarc(records) {
  const dmarc = records.find((r) => /^v=DMARC1/i.test(r.trim()));
  if (!dmarc) return { ok: false, record: null, policy: null, note: "No DMARC record found" };
  const policy = dmarc.match(/\bp=(none|quarantine|reject)\b/i)?.[1]?.toLowerCase() || "none";
  return {
    ok: true,
    record: dmarc.slice(0, 300),
    policy,
    note: policy === "none" ? "DMARC policy is p=none (monitoring only) — move to quarantine once SPF and DKIM pass" : null,
  };
}

/** Check one domain (no cache). */
export async function checkDomain(domain) {
  const d = String(domain || "").toLowerCase().trim();
  if (FREE_DOMAINS.has(d)) {
    return {
      domain: d,
      free: true,
      status: "provider",
      note: "Free mailbox provider — the provider signs these messages. You can't add records for this domain; move to your own domain for better deliverability.",
    };
  }
  const [root, dmarcRecords, dkim] = await Promise.all([
    txt(d),
    txt(`_dmarc.${d}`),
    hasDkim(d),
  ]);
  const spf = checkSpf(root);
  const dmarc = checkDmarc(dmarcRecords);
  const passing = [spf.ok, dkim.ok, dmarc.ok].filter(Boolean).length;
  return {
    domain: d,
    free: false,
    spf,
    dkim,
    dmarc,
    status: passing === 3 ? "ok" : passing === 0 ? "missing" : "partial",
    note: [spf.note, dmarc.note, dkim.ok ? null : "No DKIM record found for the usual selectors — check with your mail provider"]
      .filter(Boolean)
      .join(" · ") || null,
  };
}

/**
 * Check every domain used by active sending mailboxes (cached).
 * @param {{ refresh?: boolean, userId?: string }} opts
 */
export async function checkSendingDomains({ refresh = false, userId = null } = {}) {
  const key = userId ? `${CACHE_KEY}:${userId}` : CACHE_KEY;
  if (!refresh) {
    const hit = cache.get(key);
    if (hit) return hit;
  }

  const accounts = await prisma.emailAccount.findMany({
    where: { deleted: false, ...(userId ? { userId } : {}) },
    select: { email: true },
  });

  const counts = new Map();
  for (const a of accounts) {
    const domain = String(a.email || "").split("@")[1]?.toLowerCase();
    if (domain) counts.set(domain, (counts.get(domain) || 0) + 1);
  }

  const results = [];
  for (const [domain, mailboxes] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    results.push({ ...(await checkDomain(domain)), mailboxes });
  }

  const value = { checkedAt: new Date().toISOString(), domains: results };
  cache.set(key, value, TTL_SECONDS);
  return value;
}
