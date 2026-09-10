import { buildFont } from "../../packages/font/font.mjs";
const bytes = buildFont();
postMessage(bytes.buffer, { transfer: [bytes.buffer] });
