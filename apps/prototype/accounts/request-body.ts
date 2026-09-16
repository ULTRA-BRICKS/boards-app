import { AccessError } from "./policy";
/** Enforces bytes on the stream, not string length after buffering. */
export async function boundedText(request: Request, maximum: number): Promise<string> {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw Error("Invalid request limit");
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maximum) {
    await request.body?.cancel();
    throw new AccessError("PAYLOAD_TOO_LARGE", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new AccessError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AccessError("INVALID_ENCODING", 400);
  }
}
export async function boundedJSON(request: Request, maximum = 2_100_000): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  )
    throw new AccessError("JSON_REQUIRED", 415);
  const raw = await boundedText(request, maximum);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AccessError("INVALID_JSON", 400);
  }
}
