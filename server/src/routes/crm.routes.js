// src/routes/crm.routes.js  →  /api/crm
import express from "express";
import { protect, requireAdmin } from "../middlewares/authMiddleware.js";
import {
  listContacts,
  getContact,
  getContactTimeline,
  createContact,
  updateContact,
  deleteContact,
  createActivity,
  deleteActivity,
} from "../controllers/crm/contacts.controller.js";
import {
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
} from "../controllers/crm/companies.controller.js";
import {
  getBoard,
  listDeals,
  getDeal,
  createDeal,
  updateDeal,
  moveDeal,
  deleteDeal,
  getStages,
  createStage,
  updateStage,
  reorderStages,
  deleteStage,
} from "../controllers/crm/deals.controller.js";
import {
  listTasks,
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  listNotifications,
  markNotificationsRead,
  listCrmUsers,
} from "../controllers/crm/tasks.controller.js";
import {
  listReplies,
  updateReply,
  getAutomationSettings,
  saveAutomationSettings,
} from "../controllers/crm/automation.controller.js";

const router = express.Router();
router.use(protect);

// Lookups
router.get("/users", listCrmUsers);

// Contacts
router.get("/contacts", listContacts);
router.post("/contacts", createContact);
router.get("/contacts/:id", getContact);
router.get("/contacts/:id/timeline", getContactTimeline);
router.put("/contacts/:id", updateContact);
router.delete("/contacts/:id", deleteContact);

// Notes / calls / meetings
router.post("/activities", createActivity);
router.delete("/activities/:id", deleteActivity);

// Companies
router.get("/companies", listCompanies);
router.post("/companies", createCompany);
router.get("/companies/:id", getCompany);
router.put("/companies/:id", updateCompany);
router.delete("/companies/:id", deleteCompany);

// Pipeline stages (static paths before /:id)
router.get("/stages", getStages);
router.post("/stages", requireAdmin, createStage);
router.put("/stages/reorder", requireAdmin, reorderStages);
router.put("/stages/:id", requireAdmin, updateStage);
router.delete("/stages/:id", requireAdmin, deleteStage);

// Deals
router.get("/deals/board", getBoard);
router.get("/deals", listDeals);
router.post("/deals", createDeal);
router.get("/deals/:id", getDeal);
router.put("/deals/:id", updateDeal);
router.patch("/deals/:id/move", moveDeal);
router.delete("/deals/:id", deleteDeal);

// Tasks
router.get("/tasks", listTasks);
router.post("/tasks", createTask);
router.put("/tasks/:id", updateTask);
router.patch("/tasks/:id/complete", completeTask);
router.delete("/tasks/:id", deleteTask);

// Replies triage + reply automation settings (Phase 3)
router.get("/replies", listReplies);
router.patch("/replies/:id", updateReply);
router.get("/settings/reply-automation", getAutomationSettings);
router.put("/settings/reply-automation", requireAdmin, saveAutomationSettings);

// Notifications
router.get("/notifications", listNotifications);
router.post("/notifications/read", markNotificationsRead);

export default router;
