import { PGlite } from "@electric-sql/pglite";
import { createWorkspace } from "../../../packages/core/workspace.mjs";
import type { Database } from "../accounts/database";
import type { Identity } from "../accounts/policy";
export const actor: Identity = {
  id: "actor",
  email: "owner@corp.test",
  name: "CLIENT NAME NOT TRUSTED",
  verified: true,
  expiresAt: 4102444800000,
};
export const other: Identity = {
  id: "recipient",
  email: "member@corp.test",
  name: "Member",
  verified: true,
  expiresAt: 4102444800000,
};
export async function fixture() {
  const pg = new PGlite();
  await pg.exec(await Bun.file(new URL("../accounts/schema.sql", import.meta.url)).text());
  const db = pg as unknown as Database;
  await db.query(
    "INSERT INTO boards_accounts.users(id,email,name,verified) VALUES ('actor','owner@corp.test','Trusted Owner',true),('recipient','member@corp.test','Team Member',true),('outside','outside@other.test','Outside',true)",
  );
  const document = createWorkspace();
  for (const b of document.boards)
    for (const c of b.columns) for (const item of c.items) item.assignees = [];
  for (const id of ["space-one", "space-other"])
    await db.query(
      "INSERT INTO boards_accounts.spaces(id,name,document,allowed_domains,created_at) VALUES($1,$2,$3::jsonb,ARRAY['corp.test'],'2026-01-01T00:00:00Z')",
      [id, id, JSON.stringify(document)],
    );
  await db.query(
    "INSERT INTO boards_accounts.members(space_id,account_id,person_id,role) VALUES('space-one','actor','niko','owner'),('space-one','recipient','danny','member'),('space-other','outside','mariam','owner')",
  );
  return { pg, db, document };
}
