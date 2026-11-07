// Real Postgres for tests, without Docker: PGlite (Postgres compiled to WebAssembly)
// served over the normal Postgres protocol, so the real `pg` driver talks to it.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export async function startPostgres(port: number) {
  const db = await PGlite.create();
  // PGlite is one database session shared by every connection, so settings like
  // `SET TIME ZONE` affect all connections until reset.
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 10 });
  await server.start();
  return {
    connectionString: `postgres://postgres@127.0.0.1:${port}/postgres`,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}
