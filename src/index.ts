import { bootstrap } from "./main.js";

bootstrap().catch((error) => {
  console.error("Fatal Bootstrap Error:", error);
  process.exit(1);
});
