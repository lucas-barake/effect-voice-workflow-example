import { AppConfig } from "@/config.js";
import { PgTest, withTransactionRollback } from "@/db/pg-test.js";
import { CallRunId, CallSessionId, UploadToken } from "@app/domain/service-contract";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as PgMigrator from "@effect/sql-pg/PgMigrator";
import { beforeAll, describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Migrator from "effect/unstable/sql/Migrator";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { CallSessionRepo } from "./call-session-repo.js";

const TestConfig = Layer.succeed(AppConfig, {
  phoneProvider: "local" as const,
  publicAppOrigin: "http://localhost:4173",
  publicWebhookBaseUrl: null,
  twilioAuthToken: null,
  uploadDirectory: "./data/uploads",
  serverPort: 3000,
  localLlmApiUrl: "http://127.0.0.1:11434/v1",
  localLlmApiKey: null,
});

const TestRepoLayer = Layer.effect(CallSessionRepo, CallSessionRepo.make).pipe(
  Layer.provide(PgTest),
  Layer.provide(TestConfig),
);

const TestMigrationLayer = PgMigrator.layer({
  loader: Migrator.fromFileSystem(new URL("../../db/migrations", import.meta.url).pathname),
}).pipe(
  Layer.provide(PgTest),
  Layer.provide(NodeServices.layer),
  Layer.orDie,
);

const SESSION_ID = CallSessionId.make("10000000-0000-4000-8000-000000000001");
const RUN_ID = CallRunId.make("10000000-0000-4000-8000-000000000002");
const OTHER_RUN_ID = CallRunId.make("10000000-0000-4000-8000-000000000003");
const TOKEN = UploadToken.make("upload-token-1234567890");

beforeAll(async () => {
  await Effect.runPromise(Effect.scoped(Layer.build(TestMigrationLayer)));
});

describe("CallSessionRepo", () => {
  it.effect("creates a missing session and returns the existing one on the next call", () =>
    Effect.gen(function*() {
      const repo = yield* CallSessionRepo;

      const first = yield* repo.createIfMissing({
        sessionId: SESSION_ID,
        customerName: "Pat Jordan",
        phoneNumber: "+1-555-0199",
        email: "pat@example.com",
        zipCode: "60601",
      });
      const second = yield* repo.createIfMissing({
        sessionId: SESSION_ID,
        customerName: "Someone Else",
        phoneNumber: "+1-555-0100",
        email: "other@example.com",
        zipCode: "60602",
      });

      expect(first.id).toBe(SESSION_ID);
      expect(second.id).toBe(SESSION_ID);
      expect(second.customerName).toBe("Pat Jordan");
      expect(second.phoneNumber).toBe("+1-555-0199");
      expect(second.email).toBe("pat@example.com");
      expect(second.zipCode).toBe("60601");
      expect(second.status).toBe("intake");
    }).pipe(
      withTransactionRollback,
      Effect.provide(TestRepoLayer),
      Effect.provide(PgTest),
    ));

  it.effect("tracks active runs and clears them only for the matching run id", () =>
    Effect.gen(function*() {
      const repo = yield* CallSessionRepo;

      yield* repo.createIfMissing({
        sessionId: SESSION_ID,
        customerName: "Pat Jordan",
        phoneNumber: "+1-555-0199",
        email: "pat@example.com",
        zipCode: "60601",
      });

      const started = yield* repo.startRun({
        sessionId: SESSION_ID,
        runId: RUN_ID,
      });
      const duplicate = yield* repo.startRun({
        sessionId: SESSION_ID,
        runId: OTHER_RUN_ID,
      });

      expect(started).toBe(true);
      expect(duplicate).toBe(false);
      expect((yield* repo.findById(SESSION_ID)).activeRunId).toBe(RUN_ID);

      yield* repo.clearActiveRun({
        sessionId: SESSION_ID,
        runId: OTHER_RUN_ID,
      });
      expect((yield* repo.findById(SESSION_ID)).activeRunId).toBe(RUN_ID);

      yield* repo.clearActiveRun({
        sessionId: SESSION_ID,
        runId: RUN_ID,
      });
      expect((yield* repo.findById(SESSION_ID)).activeRunId).toBeNull();
    }).pipe(
      withTransactionRollback,
      Effect.provide(TestRepoLayer),
      Effect.provide(PgTest),
    ));

  it.effect("finishes a run and persists the structured call state", () =>
    Effect.gen(function*() {
      const repo = yield* CallSessionRepo;

      yield* repo.createIfMissing({
        sessionId: SESSION_ID,
        customerName: "Pat Jordan",
        phoneNumber: "+1-555-0199",
        email: null,
        zipCode: null,
      });
      yield* repo.startRun({
        sessionId: SESSION_ID,
        runId: RUN_ID,
      });
      yield* repo.finishRun({
        sessionId: SESSION_ID,
        runId: RUN_ID,
        customerName: "Pat Jordan",
        phoneNumber: "+1-555-0199",
        email: "pat@example.com",
        zipCode: "60601",
        applianceType: "refrigerator",
        status: "troubleshooting",
        transcript: [{
          role: "caller",
          message: "The refrigerator is warm",
          at: DateTime.formatIso(DateTime.nowUnsafe()),
        }],
        symptomSummary: [{
          key: "warm_food",
          detail: "The refrigerator compartment feels warm.",
        }],
        nextSteps: [{
          key: "check_gasket",
          instruction: "Check whether the refrigerator door closes tightly.",
          completionHint: "Try closing it again after removing any obstruction.",
        }],
        latestAssistantMessage: "Check whether the refrigerator door is sealing correctly.",
      });

      const session = yield* repo.findById(SESSION_ID);
      expect(session.activeRunId).toBeNull();
      expect(session.email).toBe("pat@example.com");
      expect(session.zipCode).toBe("60601");
      expect(session.applianceType).toBe("refrigerator");
      expect(session.status).toBe("troubleshooting");
      expect(session.latestAssistantMessage).toContain("sealing correctly");
      expect(session.transcript).toHaveLength(1);
      expect(session.symptomSummary).toEqual([{
        key: "warm_food",
        detail: "The refrigerator compartment feels warm.",
      }]);
      expect(session.nextSteps).toHaveLength(1);
    }).pipe(
      withTransactionRollback,
      Effect.provide(TestRepoLayer),
      Effect.provide(PgTest),
    ));

  it.effect("normalizes legacy malformed assistant content and decorated zip codes on read", () =>
    Effect.gen(function*() {
      const repo = yield* CallSessionRepo;
      const sql = yield* SqlClient;

      yield* sql`
        INSERT INTO call_sessions (
          id,
          customer_name,
          phone_number,
          email,
          zip_code,
          appliance_type,
          status,
          transcript,
          symptom_summary,
          next_steps,
          latest_assistant_message
        ) VALUES (
          ${SESSION_ID},
          ${"Pat Jordan"},
          ${"+1-555-0199"},
          ${"pat@example.com"},
          ${"Illinois-60601"},
          ${"refrigerator"},
          ${"troubleshooting"},
          ${
        JSON.stringify([
          {
            role: "caller",
            message: "My refrigerator is warm.",
            at: "2026-05-27T12:00:00.000Z",
          },
          {
            role: "assistant",
            message: "{\"name\":\"greet\",\"arguments\":{\"callerName\":\"Pat Jordan\"}}",
            at: "2026-05-27T12:00:05.000Z",
          },
        ])
      }::jsonb,
          ${JSON.stringify([])}::jsonb,
          ${JSON.stringify([])}::jsonb,
          ${"{\"name\":\"greet\",\"arguments\":{\"callerName\":\"Pat Jordan\"}}"}
        )
      `.pipe(Effect.orDie);

      const session = yield* repo.findById(SESSION_ID);
      const recentSessions = yield* repo.listRecent;

      expect(session.zipCode).toBe("60601");
      expect(session.transcript[1]?.message).toBe(
        "Hello Pat Jordan. How can I help with your appliance today?",
      );
      expect(session.latestAssistantMessage).toBe(
        "Hello Pat Jordan. How can I help with your appliance today?",
      );
      expect(recentSessions[0]?.latestAssistantMessage).toBe(
        "Hello Pat Jordan. How can I help with your appliance today?",
      );
    }).pipe(
      withTransactionRollback,
      Effect.provide(TestRepoLayer),
      Effect.provide(PgTest),
    ));

  it.effect("returns recommended slots, technician load, and upload sessions", () =>
    Effect.gen(function*() {
      const repo = yield* CallSessionRepo;
      const sql = yield* SqlClient;

      yield* repo.createIfMissing({
        sessionId: SESSION_ID,
        customerName: "Pat Jordan",
        phoneNumber: "+1-555-0199",
        email: "pat@example.com",
        zipCode: "60601",
      });

      const slots = yield* repo.listRecommendedSlots("60601", "refrigerator");
      expect(slots.length).toBeGreaterThan(0);
      expect(
        slots.every((slot) => slot.zipCode === "60601" && slot.applianceType === "refrigerator"),
      )
        .toBe(true);

      const technicianLoad = yield* repo.listTechnicianLoad;
      expect(technicianLoad.length).toBeGreaterThan(0);
      expect(technicianLoad[0]?.specialties.length).toBeGreaterThan(0);

      yield* sql`
        INSERT INTO upload_sessions (
          token,
          call_session_id,
          email,
          status,
          expires_at
        ) VALUES (
          ${TOKEN},
          ${SESSION_ID},
          ${"pat@example.com"},
          ${"pending"},
          NOW() + INTERVAL '1 day'
        )
      `.pipe(Effect.orDie);

      const uploads = yield* repo.listUploadSessions(SESSION_ID);
      expect(uploads).toHaveLength(1);
      expect(uploads[0]?.token).toBe(TOKEN);
      expect(uploads[0]?.uploadUrl).toBe("http://localhost:4173/upload/upload-token-1234567890");
    }).pipe(
      withTransactionRollback,
      Effect.provide(TestRepoLayer),
      Effect.provide(PgTest),
    ));
});
