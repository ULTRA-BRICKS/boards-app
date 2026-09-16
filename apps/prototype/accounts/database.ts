export interface Database {
  query<T = any>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(run: (database: Database) => Promise<T>): Promise<T>;
}
export async function first<T = any>(
  db: Database,
  text: string,
  values: unknown[] = [],
): Promise<T | undefined> {
  return (await db.query<T>(text, values)).rows[0];
}
export function postgresDatabase(connection: string): Database {
  if (!/^postgres(?:ql)?:\/\//.test(connection))
    throw Error("BOARDS_DATABASE_URL is not configured");
  const sql = new Bun.SQL(connection, { max: 3, idleTimeout: 20, connectionTimeout: 10 });
  const wrap = (client: any): Database => ({
    async query<T>(text: string, values: unknown[] = []) {
      return { rows: (await client.unsafe(text, values)) as T[] };
    },
    async transaction<T>(run: (database: Database) => Promise<T>) {
      return client.begin((tx: any) => run(wrap(tx)));
    },
  });
  return wrap(sql);
}
