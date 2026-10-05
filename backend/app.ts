import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const corsOptions = { origin: true, credentials: true };

export const app = express();
app.use(cors(corsOptions));

export const server = createServer(app);
export const io = new Server(server, { cors: corsOptions });
