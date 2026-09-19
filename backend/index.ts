import express, { type Express, type Request, type Response } from "express";

const app: Express = express();

app.get("/", (req: Request, res: Response) => {
  res.send("Hello From Express!");
});

app.listen(3000, () => {
  console.log("App listening on port 3000");
});
