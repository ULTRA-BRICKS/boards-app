import test from "node:test";
import { checkSyntax } from "../scripts/check-syntax.ts";
test("Oxc parses all application modules, including browser and TypeScript sources", checkSyntax);
