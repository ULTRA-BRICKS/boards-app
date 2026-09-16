import { newBoard } from "../../../packages/core/workspace.mjs";
import { uid, validateBoard } from "../../../packages/core/model.mjs";
export class PhotoError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export type PhotoTask = {
  id: string;
  text: string;
  done: boolean;
  assignees: string[];
  tag: string;
};
export type PhotoColumn = {
  id: string;
  title: string;
  subtitle: string;
  note: string;
  icon: string;
  items: PhotoTask[];
};
export type PhotoBoard = Omit<ReturnType<typeof newBoard>, "columns"> & { columns: PhotoColumn[] };
export type PhotoDraft = { board: PhotoBoard; warnings: string[] };
function text(value: unknown, limit: number, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new PhotoError("INVALID_RESULT", 502);
  if (value.length > limit) throw new PhotoError("TOO_MUCH_TEXT", 422);
  return value.trim();
}
export function photoDraft(value: unknown): PhotoDraft {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PhotoError("NO_READABLE_TASKS", 422);
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.columns) || data.columns.length < 1 || data.columns.length > 12)
    throw new PhotoError("NO_READABLE_TASKS", 422);
  let count = 0;
  const board: PhotoBoard = newBoard(text(data.title, 120, "From a photo"));
  board.columns = data.columns.map((raw) => {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.items) || raw.items.length > 100)
      throw new PhotoError("INVALID_RESULT", 422);
    const items = raw.items
      .map((row: unknown) => {
        const item = typeof row === "string" ? { text: row } : (row as Record<string, unknown>);
        if (!item || typeof item !== "object") throw new PhotoError("INVALID_RESULT", 422);
        return {
          id: uid(),
          text: text(item.text, 1000),
          done: item.done === true,
          assignees: [],
          tag: text(item.assigneeHint, 24),
        };
      })
      .filter((item: { text: string }) => item.text);
    count += items.length;
    return {
      id: uid(),
      title: text(raw.title, 120, "Untitled"),
      subtitle: "",
      note: "",
      icon: "auto",
      items,
    };
  });
  if (!count) throw new PhotoError("NO_READABLE_TASKS", 422);
  if (count > 500) throw new PhotoError("TOO_MUCH_TEXT", 422);
  if (data.warnings !== undefined && !Array.isArray(data.warnings))
    throw new PhotoError("INVALID_RESULT", 502);
  const warnings = ((data.warnings as unknown[]) || [])
    .slice(0, 20)
    .map((w) => text(w, 500))
    .filter(Boolean);
  const validated = validateBoard(board);
  return { board: { ...board, ...validated, id: board.id }, warnings };
}
export function parseVisionJSON(value: unknown): unknown {
  if (typeof value !== "string" || value.length > 100000)
    throw new PhotoError("INVALID_RESULT", 502);
  const clean = value
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(clean);
  } catch {
    throw new PhotoError("INVALID_RESULT", 502);
  }
}
export function validateImage(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_800_000)
    throw new PhotoError("IMAGE_TOO_LARGE", 413);
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4) throw new PhotoError("INVALID_IMAGE", 415);
  let bytes: string;
  try {
    bytes = atob(match[2].slice(0, 48));
  } catch {
    throw new PhotoError("INVALID_IMAGE", 415);
  }
  const valid =
    match[1] === "jpeg"
      ? bytes.charCodeAt(0) === 255 && bytes.charCodeAt(1) === 216 && bytes.charCodeAt(2) === 255
      : match[1] === "png"
        ? bytes.slice(0, 8) === "\x89PNG\r\n\x1a\n"
        : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
  if (!valid) throw new PhotoError("INVALID_IMAGE", 415);
  return value;
}
export function photoErrorMessage(code: string): string {
  return (
    (
      {
        VISION_NOT_CONFIGURED:
          "Photo recognition is not connected yet. Configure a vision provider in deployment settings.",
        GATEWAY_ACTIVATION_REQUIRED:
          "Vercel requires the team owner to activate AI Gateway with a card before its free credits can be used. Your photo and draft stay here.",
        PROVIDER_LIMIT:
          "The recognition provider has no available credits or is rate limited. Your photo is kept here; try again later.",
        PROVIDER_UNAVAILABLE:
          "Photo recognition is temporarily unavailable. Nothing was added to your board.",
        INVALID_RESULT:
          "The model returned a result that could not be safely read. Try a clearer photo.",
        NO_READABLE_TASKS:
          "No readable tasks were found. Choose a clearer photo or type the page manually.",
        TOO_MUCH_TEXT:
          "This photo contains more text than one import can safely handle. Crop it into smaller sections.",
        IMAGE_TOO_LARGE: "Choose a JPEG, PNG or WebP photo smaller than 12 MB.",
        INVALID_IMAGE: "Choose a valid JPEG, PNG or WebP photo.",
        SPACE_REQUIRED: "Wait for your space to connect before importing a photo.",
        CANCELLED: "Recognition cancelled. Your photo is still here.",
      } as Record<string, string>
    )[code] || "The photo could not be read. Your current boards have not changed."
  );
}
