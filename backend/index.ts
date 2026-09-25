import express, { Router } from "express";
import { app, server } from "./app";
import { scoreboardRouter } from "./routes/scoreboardController";

const router = Router();

app.use(express.json());

app.use("/api", router);

router.use(scoreboardRouter);

const PORT = Number(process.env.PORT!) || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("App listening on port 3000");
});
