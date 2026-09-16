export function bindFormDrafts(root: HTMLElement, key: string) {
  const fields = Array.from(root.querySelectorAll<HTMLInputElement>("form input[id]")).filter(
    (f) =>
      !f.readOnly &&
      !f.matches(":disabled") &&
      f.type !== "password" &&
      f.autocomplete !== "one-time-code",
  );
  if (!fields.length) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (saved && typeof saved === "object")
      for (const field of fields) {
        const value = saved[field.id];
        if (value) {
          if (field.type === "checkbox" && typeof value.checked === "boolean")
            field.checked = value.checked;
          else if (typeof value.value === "string")
            field.value = value.value.slice(0, field.maxLength > 0 ? field.maxLength : 10000);
        }
      }
  } catch {}
  const save = () => {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify(
          Object.fromEntries(
            fields.map((f) => [
              f.id,
              f.type === "checkbox" ? { checked: f.checked } : { value: f.value },
            ]),
          ),
        ),
      );
    } catch {
      const status = root.querySelector("[role=status]");
      if (status)
        status.textContent = "Draft backup is unavailable. Keep this tab open until changes save.";
    }
  };
  fields.forEach((f) => {
    f.addEventListener("input", save);
    f.addEventListener("change", save);
  });
}
export function draftValue(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function clearUnchangedDraft(key: string, before: string | null) {
  try {
    if (sessionStorage.getItem(key) === before) sessionStorage.removeItem(key);
  } catch {}
}
