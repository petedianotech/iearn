import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import cors from "cors";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase Config
const firebaseConfigPath = path.join(__dirname, "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));

// Initialize Firebase Admin
// In AI Studio Build, the environment is pre-configured with credentials for the project
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = admin.firestore(firebaseConfig.firestoreDatabaseId);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API Route: Postback for Ad Networks (e.g., CPALead)
  // Example URL: https://your-app.vercel.app/api/postback?userId={userId}&reward={reward}&secret=YOUR_SECRET
  app.get("/api/postback", async (req, res) => {
    const { userId, reward, secret, taskId } = req.query;

    console.log("Received postback:", { userId, reward, taskId });

    // 1. Verify Secret
    const expectedSecret = process.env.POSTBACK_SECRET || "my_super_secret_postback_key";
    if (secret !== expectedSecret) {
      console.error("Invalid postback secret");
      return res.status(403).send("Invalid secret");
    }

    if (!userId || !reward) {
      return res.status(400).send("Missing userId or reward");
    }

    try {
      const rewardNum = parseFloat(reward as string);
      const userRef = db.collection("users").doc(userId as string);
      
      // Update user balance and daily earnings
      await userRef.update({
        balance: admin.firestore.FieldValue.increment(rewardNum),
        dailyEarnings: admin.firestore.FieldValue.increment(rewardNum)
      });

      // Log the task completion
      await db.collection("userTasks").add({
        userId: userId as string,
        taskId: (taskId as string) || "external_offer",
        reward: rewardNum,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: "postback"
      });

      console.log(`Successfully credited ${rewardNum} MWK to user ${userId}`);
      res.status(200).send("OK");
    } catch (error) {
      console.error("Error processing postback:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
