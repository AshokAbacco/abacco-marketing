import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";


const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
};


export const registerUser = async (req, res) => {
    try {
        const { email, password, empId } = req.body;


        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }


        const exists = await prisma.user.findUnique({ where: { email } });
        if (exists) return res.status(400).json({ error: "User already exists" });


        const hash = await bcrypt.hash(password, 10);


        const user = await prisma.user.create({
            data: { email, password: hash, empId },
        });


        res.status(201).json({
            id: user.id,
            email: user.email,
            empId: user.empId,
            token: generateToken(user.id),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};


export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;


        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(401).json({ error: "Invalid email or password" });


        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: "Invalid email or password" });


        res.json({
            id: user.id,
            email: user.email,
            empId: user.empId,
            token: generateToken(user.id),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};