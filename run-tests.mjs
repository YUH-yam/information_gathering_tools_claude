import { __runSelfTests } from "./js/tests.js";
const r = __runSelfTests();
console.log("\n=== SUMMARY ===");
console.log(r.summary);
process.exit(r.fail === 0 ? 0 : 1);
