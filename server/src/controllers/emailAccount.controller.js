import { encrypt } from "../utils/crypto.js";
import { ImapFlow } from "imapflow";
import prisma from "../prismaClient.js";

// Shared client — a `new PrismaClient()` here opened a second connection pool.

async function testImapConnection({ host, port, user, pass }) {
  const client = new ImapFlow({
    host,
    port: Number(port),
    secure: Number(port) === 993,
    auth: {
      user,
      pass,
    },
    logger: false,
  });

  try {
    await client.connect();
    await client.logout();
    return true;
  } catch (err) {
    throw err;
  }
}

export const addAccount = async (req, res) => {
  try {
    let {
      email,
      provider,
      imapHost,
      imapPort,
      smtpHost,
      smtpPort,
      imapUser,
      encryptedPass,
      senderName,
    } = req.body;

    // ============================
    // 👉 RedFF Auto Configuration
    // ============================
    if (provider?.toLowerCase() === "redff") {
      imapHost = "imap.rediffmailpro.com";
      imapPort = 993;
      smtpHost = "smtp.rediffmailpro.com";
      smtpPort = 465;
      imapUser = email;
    }

    // ============================
    // 1. Validate required fields
    // ============================
    if (!email || !imapHost || !imapPort || !imapUser || !encryptedPass) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    // ============================
    // 2. TEST IMAP LOGIN BEFORE SAVING
    // ============================
    try {
      await testImapConnection({
        host: imapHost,
        port: imapPort,
        user: imapUser,
        pass: encryptedPass, // raw password for test
      });
    } catch (imapError) {
      console.error("IMAP Test Failed:", imapError.message);

      let friendly = "IMAP Login Failed";

      if (imapError.code === "ENOTFOUND") {
        friendly = "Mail server not reachable (wrong host)";
      } else if (imapError.authenticationFailed) {
        friendly = "Invalid email or password";
      } else if (imapError.code === "ETIMEDOUT") {
        friendly = "Connection timed out (server blocked)";
      } else if (imapError.message?.includes("TLS")) {
        friendly = "TLS/SSL connection failed";
      }

      return res.status(400).json({
        success: false,
        error: friendly,
        debug: imapError.message,
      });
    }

    // ============================
    // 3. Encrypt password after success
    // ============================
    const encryptedPassword = await encrypt(encryptedPass);

    // ============================
    // 4. Save to DB
    // ============================
    const account = await prisma.emailAccount.create({
      data: {
        email,
        provider,
        imapHost,
        imapPort: Number(imapPort),
        smtpHost,
        smtpPort: Number(smtpPort),
        username: imapUser,
        encryptedPass: encryptedPassword,
        senderName,
      },
    });

    return res.json({ success: true, account });
  } catch (err) {
    console.error("Add account failed:", err);
    res.status(500).json({
      success: false,
      error: "Server error",
      debug: err.message,
    });
  }
};

// ===============================
// Other functions unchanged
// ===============================

export const getAccountById = async (req, res) => {
  const account = await prisma.emailAccount.findUnique({
    where: { id: req.params.id },
  });
  res.json(account);
};

export const listAccounts = async (req, res) => {
  const accounts = await prisma.emailAccount.findMany();
  res.json(accounts);
};
