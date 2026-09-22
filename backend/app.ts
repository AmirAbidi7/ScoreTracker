import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

export const app = express();
export const server = createServer(app);
export const io = new Server(server);
