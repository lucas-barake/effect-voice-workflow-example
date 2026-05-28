import * as Effect from "effect/Effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";

export default Effect.gen(function*() {
  const sql = yield* SqlClient;

  yield* sql`
    ALTER TABLE call_sessions
    ADD COLUMN IF NOT EXISTS active_run_id UUID NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS call_sessions_active_run_idx
    ON call_sessions (active_run_id)
  `;
});
