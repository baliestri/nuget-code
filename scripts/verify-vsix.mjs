import { verifyVsix } from "./release/artifact.ts";

const index = process.argv.indexOf("--manifest");
if (index < 0 || !process.argv[index + 1])
  throw new Error("Usage: verify-vsix.mjs --manifest <path>");
const artifact = await verifyVsix(process.argv[index + 1]);
console.log(`${artifact.vsixName} ${artifact.sha256} ${artifact.sourceSha}`);
