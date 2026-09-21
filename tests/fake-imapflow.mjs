// Minimal ImapFlow stand-in: one INBOX whose messages come from globalThis.__imapMessages.
export class ImapFlow {
  constructor(opts) { this.opts = opts; this.mailbox = false; }
  on() {}
  async connect() {}
  async list() { return [{ path: "INBOX", flags: new Set(), specialUse: "\\Inbox" }]; }
  async getMailboxLock() { this.mailbox = { exists: (globalThis.__imapMessages || []).length }; return { release() {} }; }
  async search(q) {
    const all = (globalThis.__imapMessages || []).map((m) => m.uid);
    if (q.uid) { const from = Number(String(q.uid).split(":")[0]); return all.filter((u) => u >= from).concat(all.length ? [Math.max(...all)] : []); }
    return all;
  }
  async *fetch(range) {
    for (const uid of range) {
      const m = globalThis.__imapMessages.find((x) => x.uid === uid);
      if (m) yield { uid, envelope: { messageId: m.messageId }, internalDate: new Date() };
    }
  }
  async fetchOne(uid) { return { source: globalThis.__imapMessages.find((x) => x.uid === uid).raw }; }
  async logout() {}
}
export default { ImapFlow };
