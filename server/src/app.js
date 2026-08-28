// server/src/app.js
import prisma from "./prismaClient.js";

async function startupSafety() {
  await prisma.campaign.updateMany({
    where: { status: "sending" },
    data: { status: "paused" }
  });

  console.log("Recovered interrupted campaigns → marked as paused");
}

startupSafety();
