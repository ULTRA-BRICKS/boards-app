/** These three initial/name mappings were explicitly supplied with the source board. */
const initialNames = { D: "danny", N: "niko", M: "mariam" };
const hints = (item) => [
  ...new Set(
    String(item.tag || "")
      .split("/")
      .map((x) => x.trim())
      .filter(Boolean),
  ),
];
function matches(hint, person) {
  const name = initialNames[hint];
  return !!name && (person?.id === name || person?.name?.toLowerCase().split(/\s+/)[0] === name);
}
export function unresolvedHints(item, people) {
  return hints(item).filter(
    (hint) =>
      !item.assignees.some((id) =>
        matches(
          hint,
          people.find((p) => p.id === id),
        ),
      ),
  );
}
export function setAssignee(item, person, { remove = false, resolveHint = "" } = {}) {
  if (!person?.id) throw Error("Choose a person first.");
  const ids = new Set(item.assignees || []);
  if (remove && !resolveHint) ids.delete(person.id);
  else ids.add(person.id);
  item.assignees = [...ids];
  // Adding someone never silently removes an unrelated S or ? from the original note.
  item.tag = hints(item)
    .filter((hint) => hint !== resolveHint && !matches(hint, person))
    .join("/");
  return item;
}
