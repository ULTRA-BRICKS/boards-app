import { buildFont } from "../../../packages/font/font.mjs";
const data = buildFont();
postMessage(data.buffer, { transfer: [data.buffer] });
