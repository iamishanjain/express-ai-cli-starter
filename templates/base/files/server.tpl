import app from "./app.js";

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
