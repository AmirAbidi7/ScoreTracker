import express, { Router } from "express";
import { app, server } from "./app";
import { scoreboardRouter } from "./routes/scoreboardController";

const router = Router();

app.use(express.json());

app.use("/api", router);

router.use(scoreboardRouter);

server.listen(process.env.PORT!, () => {
  console.log("App listening on port 3000");
});
