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
