type Task = { id: string; text: string; tag: string; done: boolean; assignees: string[] };
type Column = { id: string; title: string; items: Task[] };
type Board = { id: string; title: string; tagline: string; footer: string; columns: Column[] };
type Person = { id: string; email: string; avatar: string; slackUserId: string };
import { test, expect } from "bun:test";
import { references } from "../../packages/core/references.mjs";
import {
  createWorkspace,
  projectShare,
  validateWorkspace,
  safeURL,
} from "../../packages/core/workspace.mjs";
import { body, esc } from "../../server/http.mjs";
import { MemoryStore } from "../../server/store.mjs";
import { fetchHandler } from "../../server/fetch-adapter.ts";
// Equivalence-class cases vary real parser/security inputs. They are not 2,000 hand-authored user journeys.
const repos = [
  "ultrabricks/boards-app",
  "a/b",
  "owner/repo.name",
  "team-name/app_v2",
  "ABC/Repo",
  "a1/r2",
  "maintainer/x-y",
  "test-repo/r.x",
];
const numbers = [1, 2, 9, 10, 99, 100, 9999, 2147483647];
const wrappers = [
  ["", ""],
  ["See ", "."],
  ["(", ")"],
  ['"', '"'],
];
for (const repo of repos)
  for (const number of numbers)
    for (const kind of ["issue", "pr"])
      for (const [prefix, suffix] of wrappers) {
        test(`reference/full/${repo}/${kind}/${number}/${prefix}`, () => {
          const url = `https://github.com/${repo}/${kind === "pr" ? "pull" : "issues"}/${number}`;
          const hits = references(prefix + url + suffix, repo);
          expect(hits).toHaveLength(1);
          expect(hits[0].repo).toBe(repo);
          expect(hits[0].number).toBe(number);
          expect(hits[0].kind).toBe(kind);
        });
        test(`reference/context/${repo}/${kind}/${number}/${prefix}`, () => {
          const query = kind === "pr" ? `PR #${number}` : `#${number}`;
          const hits = references(prefix + query + suffix, repo);
          expect(hits).toHaveLength(1);
          expect(hits[0].repo).toBe(repo);
          expect(hits[0].number).toBe(number);
          expect(hits[0].kind).toBe(kind);
        });
      }
for (const team of ["ENG", "UI", "CORE", "APP", "SDK", "WEB", "DX", "A1"])
  for (const number of numbers)
    for (const [prefix, suffix] of wrappers) {
      test(`reference/linear/${team}/${number}/${prefix}`, () => {
        const id = `${team}-${number}`,
          hits = references(`${prefix}https://linear.app/team/issue/${id}/a-task${suffix}`);
        expect(hits).toHaveLength(1);
        expect(hits[0].identifier).toBe(id);
        expect(hits[0].provider).toBe("linear");
      });
    }
const texts = [
  "hello",
  "Привет",
  "ёжик",
  "🙂",
  "𐍈",
  "e\u0301",
  "مرحبا",
  "漢字",
  "abc\nxyz",
  'a\t"b',
  "<script>x</script>",
  "a\\b",
  "∑π∞",
  "text\u0000zero",
  "a\r\nb",
  "🧑‍💻",
  "x".repeat(61),
  "字".repeat(31),
  "Ё".repeat(20),
  "🐀🐕",
  "שלום",
  "👍🏽",
  "ქართული",
  "résumé",
];
for (const text of texts)
  for (const size of [1, 2, 3, 4, 7, 8, 16, 31]) {
    test(`utf8/chunks/${texts.indexOf(text)}/${size}`, async () => {
      const value = { text },
        bytes = Buffer.from(JSON.stringify(value));
      const req = {
        headers: { "content-type": "application/json" },
        async *[Symbol.asyncIterator]() {
          for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
        },
      };
      expect(await body(req)).toEqual(value);
    });
  }
const limits = [
  ["title", 120],
  ["tagline", 180],
  ["footer", 240],
] as const;
for (const [key, max] of limits)
  for (const text of texts)
    for (const delta of [-1, 0, 1]) {
      test(`schema/limit/${key}/${texts.indexOf(text)}/${delta}`, () => {
        const ws = createWorkspace(),
          value = text.repeat(max + 2).slice(0, max + delta);
        ws.boards[0][key] = value;
        if (delta > 0) expect(() => validateWorkspace(ws)).toThrow();
        else expect(validateWorkspace(ws).boards[0][key]).toBe(value);
      });
    }
const rawTasks = createWorkspace().boards[0].columns.flatMap((c: Column) => c.items);
for (const task of rawTasks)
  for (const kind of ["item", "items", "column", "board", "space"])
    for (const neighbors of [false, true]) {
      test(`share/redaction/${task.id}/${kind}/${neighbors}`, () => {
        const ws = createWorkspace();
        ws.name = "PRIVATE-WORKSPACE";
        ws.people.forEach((p: Person) => {
          p.email = `${p.id}@private.example`;
          p.slackUserId = "USECRET";
          p.avatar = "https://avatars.slack-edge.com/private.jpg";
        });
        const column = ws.boards[0].columns.find((c: Column) =>
          c.items.some((t: Task) => t.id === task.id),
        )!;
        const result = projectShare(ws, {
            kind,
            boardId: "roadmap",
            columnId: column.id,
            itemIds: [task.id],
            neighbors,
          }),
          encoded = JSON.stringify(result);
        expect(encoded).not.toContain("PRIVATE-WORKSPACE");
        expect(encoded).not.toContain("@private.example");
        expect(encoded).not.toContain("USECRET");
        expect(encoded).not.toContain("private.jpg");
        if (kind === "item" && !neighbors)
          expect(
            result.boards.flatMap((b: Board) => b.columns.flatMap((c: Column) => c.items)),
          ).toHaveLength(1);
        expect(encoded).toContain(task.text);
      });
    }
for (const host of ["example.test", "127.0.0.1", "[::1]", "avatars.githubusercontent.com"])
  for (const scheme of ["http", "ftp", "javascript", "file", "data", "vbscript", "ws", "wss"])
    for (const path of ["/", "/image", "/a?x=1", "#test"]) {
      test(`avatar/protocol/${host}/${scheme}/${path}`, () =>
        expect(safeURL(`${scheme}://${host}${path}`, { avatar: true })).toBe(""));
    }
for (const token of ["<", ">", "&", '"', "'", "<script>", "</style>", '<img onerror="x">'])
  for (const text of texts) {
    test(`escape/html/${token}/${texts.indexOf(text)}`, () => {
      const value = esc(token + text);
      expect(value).not.toMatch(/[<>"']/);
      expect(esc(token + text)).toBe(value);
    });
  }
for (const route of [
  "state",
  "people",
  "asset",
  "avatar",
  "search",
  "illustration",
  "photo",
  "import",
  "ticket",
  "backlink",
  "share",
  "proposals/confirm",
  "proposals/link",
  "slack/sync",
  "share/revoke",
])
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    test(`authorization/${method}/${route}`, async () => {
      const env = {
        APP_ORIGIN: "https://boards.example",
        OWNER_EMAIL: "owner@example.test",
        DATABASE_URL: "postgresql://fixture/db",
        GITHUB_CLIENT_ID: "fixture",
        GITHUB_CLIENT_SECRET: "fixture",
      };
      const handler = fetchHandler({ env, store: new MemoryStore() });
      const response = await handler(
        new Request(`https://boards.example/api/${route}`, {
          method,
          headers: {
            Origin: env.APP_ORIGIN,
            ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
          },
          ...(method === "GET" ? {} : { body: "{}" }),
        }),
      );
      expect(response.status).toBe(401);
    });
  }
