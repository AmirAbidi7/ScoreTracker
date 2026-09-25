import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

// The app has no accounts, so every origin is acceptable. The Expo web client
// runs on :8081 while the API runs on :3000, and native clients send no Origin.
const corsOptions = { origin: true, credentials: true };

export const app = express();
app.use(cors(corsOptions));

export const server = createServer(app);
export const io = new Server(server, { cors: corsOptions });
