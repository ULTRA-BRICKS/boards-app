export function openTaskCounts(workspace: {
  boards: { columns: { items: { done: boolean; assignees: string[] }[] }[] }[];
}) {
  const counts = new Map<string, number>();
  for (const board of workspace.boards)
    for (const column of board.columns)
      for (const item of column.items) {
        if (item.done) continue;
        for (const id of new Set(item.assignees)) counts.set(id, (counts.get(id) || 0) + 1);
      }
  return counts;
}
export async function mapLimited<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new RangeError("Concurrency must be 1–16");
  const result = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, concurrency) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        result[index] = await fn(items[index], index);
      }
    }),
  );
  return result;
}
