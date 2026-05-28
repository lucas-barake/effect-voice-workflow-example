import * as Effect from "effect/Effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";

export default Effect.gen(function*() {
  const sql = yield* SqlClient;

  yield* sql`
    UPDATE call_sessions
    SET transcript = '[]'::jsonb
    WHERE jsonb_typeof(transcript) = 'object'
  `;

  yield* sql`
    UPDATE call_sessions
    SET symptom_summary = '[]'::jsonb
    WHERE jsonb_typeof(symptom_summary) = 'object'
  `;

  yield* sql`
    UPDATE call_sessions
    SET next_steps = '[]'::jsonb
    WHERE jsonb_typeof(next_steps) = 'object'
  `;
});
