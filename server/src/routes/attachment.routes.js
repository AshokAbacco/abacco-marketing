// server/src/routes/attachment.routes.js
import express from "express";
// Shared client — `new PrismaClient()` here opened an extra connection pool.
import prisma from "../prismaClient.js";

const router = express.Router();

router.get("/:id", async (req, res) => {
  const attachment = await prisma.attachment.findUnique({
    where: { id: req.params.id },
  });

  if (!attachment) {
    return res.status(404).send("Not found");
  }

  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${attachment.filename}"`,
  );

  res.send(Buffer.from(attachment.data));
});

export default router;
