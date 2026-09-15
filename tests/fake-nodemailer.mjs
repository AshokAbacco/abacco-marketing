export const sent = globalThis.__sent = [];
export const behaviour = globalThis.__smtpBehaviour = new Map(); // email -> array of errors to throw in order
let transportsOpen = 0; let transportsClosed = 0;
globalThis.__transports = () => ({ transportsOpen, transportsClosed });
export default {
  createTransport(opts) {
    transportsOpen++;
    return {
      async sendMail(mail) {
        await new Promise(r => setTimeout(r, 5));
        const q = behaviour.get(mail.to);
        if (q && q.length) { throw q.shift(); }
        sent.push({ ...mail, via: opts.auth.user });
        return { messageId: mail.messageId };
      },
      close() { transportsClosed++; },
    };
  },
};
