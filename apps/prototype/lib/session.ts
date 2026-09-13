export function readJSON(key: string) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
export function writeJSON(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export async function notebookCacheKey(capability: string) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(capability));
  return (
    "boards:tab:" +
    Array.from(new Uint8Array(data), (x) => x.toString(16).padStart(2, "0")).join("")
  );
}
export function readSnapshot(key: string) {
  const record = readJSON(key);
  if (
    !record ||
    !Number.isInteger(record.version) ||
    record.version < 0 ||
    (record.version === 0 && record.creating !== true)
  )
    return null;
  // Unsaved input is not an expiring read cache. Preserve it until explicit recovery/discard.
  if (record.pending === true || readJSON(key + ":draft")?.value !== undefined) return record;
  const age = Date.now() - record.saved;
  return Number.isFinite(age) && age >= 0 && age < 12 * 3600000 ? record : null;
}
export function saveSnapshot(key: string, version: number, value: unknown, pending: boolean) {
  return writeJSON(key, { version, value, pending, creating: version === 0, saved: Date.now() });
}
export function anonymousExpiry(jwt: string) {
  try {
    const c = JSON.parse(atob(jwt.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/")));
    return c.role === "anonymous" && Number.isFinite(c.exp)
      ? Math.min(c.exp * 1000 - 30000, Date.now() + 240000)
      : 0;
  } catch {
    return 0;
  }
}
