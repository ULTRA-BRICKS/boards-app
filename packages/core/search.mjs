import { opposedActions } from "./intent.mjs";
/** Small-corpus BM25 + vector RRF. Context is a bonus, never a substitute for relevance. */
export const tokens = (text) =>
  String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .match(/[\p{L}\p{N}_-]+/gu) || [];
export const normalized = (text) => tokens(text).join(" ");
export function cosine(a, b) {
  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    !a.length ||
    a.length !== b.length ||
    a.some((v) => !Number.isFinite(v)) ||
    b.some((v) => !Number.isFinite(v))
  )
    throw Error("Incompatible embedding vectors");
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export function documents(ws) {
  return ws.boards.flatMap((b) =>
    b.columns.flatMap((c) =>
      c.items.map((t) => ({
        id: `${b.id}:${t.id}`,
        boardId: b.id,
        columnId: c.id,
        itemId: t.id,
        title: t.text,
        text: `${t.text}\n${c.title}\n${b.title}`,
        boardTitle: b.title,
        columnTitle: c.title,
        done: t.done,
        assignees: t.assignees,
      })),
    ),
  );
}
function near(a, b) {
  if (a === b) return true;
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    n = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++n > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return n + (a.length - i) + (b.length - j) <= 1;
}
const stopwords = new Set(
  "a an the to for of in on at by from into with and or is are be this that your и в во на по с со к ко для от до из у о об это как что".split(
    " ",
  ),
);
const contentTokens = (text) => tokens(text).filter((t) => !stopwords.has(t));
export function lexical(query, docs) {
  const terms = contentTokens(query);
  if (!terms.length) return [];
  const all = docs.map((d) => contentTokens(d.text || d.title)),
    avg = all.reduce((n, t) => n + t.length, 0) / Math.max(1, all.length),
    df = terms.map((term) => all.filter((a) => a.some((t) => near(t, term))).length);
  return docs
    .map((doc, i) => {
      let score = 0;
      terms.forEach((term, j) => {
        const tf = all[i].filter((t) => near(t, term)).length;
        if (tf)
          score +=
            (Math.log(1 + (docs.length - df[j] + 0.5) / (df[j] + 0.5)) * (tf * 2.2)) /
            (tf + 1.2 * (0.25 + (0.75 * all[i].length) / (avg || 1)));
      });
      if (normalized(doc.title).includes(normalized(query))) score += 4;
      return { ...doc, lexical: score };
    })
    .filter((d) => d.lexical > 0)
    .sort((a, b) => b.lexical - a.lexical);
}
export function rank(
  query,
  docs,
  {
    boardId = "",
    columnId = "",
    vectors = new Map(),
    queryVector = null,
    duplicate = false,
    threshold = 0.88,
    exclude = "",
  } = {},
) {
  const candidates = docs.filter(
      (d) => d.id !== exclude && (!duplicate || !opposedActions(query, d.title)),
    ),
    lex = lexical(query, candidates),
    sem = queryVector
      ? candidates
          .filter((d) => vectors.has(d.id))
          .map((d) => ({ ...d, similarity: cosine(queryVector, vectors.get(d.id)) }))
          .sort((a, b) => b.similarity - a.similarity)
      : [],
    scores = new Map();
  const add = (d, n, kind) => {
    const v = scores.get(d.id) || { ...d, score: 0 };
    v.score += 1 / (60 + n + 1);
    if (kind === "semantic") v.similarity = d.similarity;
    else v.lexical = d.lexical;
    scores.set(d.id, v);
  };
  lex.forEach((d, i) => add(d, i, "lexical"));
  sem.filter((d) => d.similarity > 0.3).forEach((d, i) => add(d, i, "semantic"));
  return [...scores.values()]
    .map((d) => {
      const exact = normalized(d.title) === normalized(query);
      return {
        ...d,
        exact,
        score:
          (exact ? 1 : 0) +
          d.score *
            (1 +
              (d.boardId === boardId ? 0.2 : 0) +
              (d.boardId === boardId && d.columnId === columnId ? 0.15 : 0)),
      };
    })
    .filter(
      (d) =>
        !duplicate ||
        d.exact ||
        (queryVector
          ? d.similarity >= threshold
          : normalized(d.title).includes(normalized(query)) && tokens(query).length >= 3),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, duplicate ? 5 : 30);
}
