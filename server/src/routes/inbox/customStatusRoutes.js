import express from "express";
import { protect, requireAdmin } from "../../middlewares/authMiddleware.js";
// Shared client — `new PrismaClient()` here opened an extra connection pool.
import prisma from "../../prismaClient.js";

const router = express.Router();

// =======================================================
// GET all custom lead statuses
// =======================================================
router.get("/", protect, async (req, res) => {
  try {
    const statuses = await prisma.customLeadStatus.findMany({
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: statuses });
  } catch (error) {
    console.error("Error fetching custom statuses:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch custom statuses",
    });
  }
});

// =======================================================
// CREATE a new custom lead status
// =======================================================
router.post("/", protect, requireAdmin, async (req, res) => {
  try {
    const { name, color, description } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Status name is required",
      });
    }

    const existing = await prisma.customLeadStatus.findFirst({
      where: { name: name.trim() },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Status with this name already exists",
      });
    }

    const newStatus = await prisma.customLeadStatus.create({
      data: {
        name: name.trim(),
        color: color || "bg-gray-100 text-gray-800 border-gray-200",
        description: description || "",
      },
    });

    res.json({
      success: true,
      data: newStatus,
      message: "Custom status created successfully",
    });
  } catch (error) {
    console.error("Error creating custom status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create custom status",
    });
  }
});

// =======================================================
// UPDATE custom lead status
// =======================================================
router.put("/:id", protect, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, description } = req.body;

    const updatedStatus = await prisma.customLeadStatus.update({
      where: { id: Number(id) },
      data: {
        ...(name && { name: name.trim() }),
        ...(color && { color }),
        ...(description !== undefined && { description }),
      },
    });

    res.json({
      success: true,
      data: updatedStatus,
      message: "Custom status updated successfully",
    });
  } catch (error) {
    console.error("Error updating custom status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update custom status",
    });
  }
});

// =======================================================
// DELETE custom lead status
// =======================================================
router.delete("/:id", protect, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const inUse = await prisma.leadDetails.findFirst({
      where: { leadStatus: String(id) },
    });

    if (inUse) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete status assigned to leads",
      });
    }

    await prisma.customLeadStatus.delete({
      where: { id: Number(id) },
    });

    res.json({
      success: true,
      message: "Custom status deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting custom status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete custom status",
    });
  }
});

export default router;
