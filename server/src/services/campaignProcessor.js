// src/services/campaignProcessor.js 

import prisma from "../prismaClient.js";
import pLimit from "p-limit";

const limit = pLimit(2);

export const runCampaigns = async () => {
  const accounts = await prisma.account.findMany();

  await Promise.all(
    accounts.map(acc =>
      limit(() => processAccount(acc))
    )
  );
};

const processAccount = async (acc) => {
  console.log("Processing:", acc.id);

  // your campaign logic here
};