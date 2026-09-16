/** Cloud persistence is authoritative; clearing a local recovery copy is a separate step. */
export async function savePhotoAndCleanDraft(
  save: () => Promise<void>,
  remove: () => Promise<void>,
): Promise<{ saved: true; draftRemoved: boolean }> {
  await save();
  try {
    await remove();
    return { saved: true, draftRemoved: true };
  } catch {
    return { saved: true, draftRemoved: false };
  }
}
