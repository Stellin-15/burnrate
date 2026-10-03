// Validates models.json. Runs in CI so a pricing PR can't merge with broken data.
import { readFileSync } from "node:fs";
import { validatePricingTable } from "../src/validate.ts";

const file = new URL("../models.json", import.meta.url);
const errors = validatePricingTable(JSON.parse(readFileSync(file, "utf8")));
if (errors.length) {
  console.error(`models.json has ${errors.length} problem(s):\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}
console.log("models.json is valid");
