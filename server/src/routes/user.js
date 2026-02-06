import express from "express";
import { registerUser, loginUser, getAllUsers, updateUser, deleteUser, toggleUserStatus } from "../controllers/userController.js";




const router = express.Router();
 

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/all", getAllUsers);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);
router.put("/:id/status", toggleUserStatus);




export default router;