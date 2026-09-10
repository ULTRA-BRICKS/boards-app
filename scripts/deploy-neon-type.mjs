/** Independent of GitHub/Vercel. Uses your local authenticated Neon CLI profile. */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand, staticDeploymentEnvironment } from "./deployment.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = staticDeploymentEnvironment();
runCommand(process.execPath, ["scripts/build-neon-type.mjs"], { cwd: root, env });
runCommand("bun", ["x", "--bun", "neon@latest", "functions", "deploy", "conlocatype", "--src", resolve(root, "dist/type-neon"), "--no-bundle", "--runtime", "nodejs24", "--project-id", "crimson-hall-13043037", "--branch", "br-quiet-wind-aylocgl0", "--wait"], { cwd: root, env });
console.log("Neon deployment command finished. Check the returned invocation URL and /health.");
