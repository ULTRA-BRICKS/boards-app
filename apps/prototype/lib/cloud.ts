import { diagnose } from "./diagnostics";
export class CloudFailure extends Error {
  constructor(
    public code: string,
    public operation: string,
    public status = 0,
  ) {
    super(
      code === "40001"
        ? "Another session changed this page."
        : code === "42501"
          ? "This cloud page is unavailable. Check the link you opened."
          : code === "TIMEOUT"
            ? "The cloud took too long to respond. Please retry."
            : code === "NETWORK"
              ? "The cloud could not be reached. Check your connection and retry."
              : code === "BAD_RESPONSE"
                ? "The cloud returned an invalid response. Please retry."
                : `The cloud request failed${status ? " (HTTP " + status + ")" : ""}.`,
    );
  }
}
export async function cloudJSON(path: string, init: RequestInit, operation: string) {
  const start = performance.now();
  diagnose("request.started", { operation });
  try {
    const response = await fetch(path, { ...init, credentials: "omit", cache: "no-store" });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new CloudFailure("BAD_RESPONSE", operation, response.status);
    }
    if (!response.ok)
      throw new CloudFailure(
        data?.code === "40001" ? "40001" : data?.code === "42501" ? "42501" : "HTTP",
        operation,
        response.status,
      );
    diagnose("request.finished", {
      operation,
      status: response.status,
      ms: performance.now() - start,
    });
    return data;
  } catch (error) {
    const failure =
      error instanceof CloudFailure
        ? error
        : new CloudFailure(
            (error as Error)?.name === "TimeoutError"
              ? "TIMEOUT"
              : (error as Error)?.name === "AbortError"
                ? "ABORT"
                : "NETWORK",
            operation,
          );
    diagnose("request.failed", {
      operation,
      code:
        failure.code === "40001"
          ? "CONFLICT"
          : failure.code === "42501"
            ? "UNAVAILABLE"
            : failure.code,
      status: failure.status,
      ms: performance.now() - start,
    });
    throw failure;
  }
}
export const pageTitle = (name: unknown) =>
  `${typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : "Untitled"} | Boards`;
export function hasUnsaved(queue?: { sequence: number; ack: number } | null) {
  return !!queue && queue.sequence > queue.ack;
}
