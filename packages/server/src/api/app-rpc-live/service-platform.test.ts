import { AppConfig } from "@/config.js";
import { PgTest, withTransactionRollback } from "@/db/pg-test.js";
import { CallSessionId, SlotId } from "@app/domain/service-contract";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as PgMigrator from "@effect/sql-pg/PgMigrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Migrator from "effect/unstable/sql/Migrator";
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CallSessionRepo } from "./call-session-repo.js";
import { ServicePlatform } from "./service-platform.js";
import { VisionDiagnosticAgent } from "./vision-diagnostic-agent.js";

const SESSION_ID = CallSessionId.make("30000000-0000-4000-8000-000000000001");
const SLOT_ID = SlotId.make("7295fd1f-2bd1-4c3e-88b8-bb51d5900003");
const UploadDirectory = path.join(
  os.tmpdir(),
  `household-ops-platform-uploads-${process.pid}`,
);

const TestConfig = Layer.succeed(AppConfig, {
  publicAppOrigin: "http://localhost:4173",
  publicWebhookBaseUrl: null,
  twilioAuthToken: null,
  uploadDirectory: UploadDirectory,
  serverPort: 3000,
  localLlmApiUrl: "http://127.0.0.1:11434/v1",
  localLlmApiKey: null,
});

const VisionDiagnosticAgentTest = Layer.succeed(
  VisionDiagnosticAgent,
  VisionDiagnosticAgent.of({
    analyzeUpload: () =>
      Effect.succeed({
        recognizedApplianceType: "refrigerator",
        analysisSummary: "Condenser area shows heavy dust accumulation.",
        visibleSignals: [{
          key: "dust_buildup",
          detail: "Visible dust and lint around the condenser vent.",
        }],
      }),
  }),
);

const TestRepoLayer = Layer.effect(CallSessionRepo, CallSessionRepo.make).pipe(
  Layer.provide(PgTest),
  Layer.provide(TestConfig),
);

const TestServiceLayer = Layer.effect(ServicePlatform, ServicePlatform.make).pipe(
  Layer.provide(VisionDiagnosticAgentTest),
  Layer.provide(TestRepoLayer),
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

beforeAll(async () => {
  await Effect.runPromise(Effect.scoped(Layer.build(TestMigrationLayer)));
});

beforeEach(async () => {
  await mkdir(UploadDirectory, { recursive: true });
});

afterAll(async () => {
  await rm(UploadDirectory, { recursive: true, force: true });
});

describe("ServicePlatform", () => {
  it.effect("books an appointment and reflects it in the dashboard and session snapshot", () =>
    Effect.gen(function*() {
      const repo = yield* CallSessionRepo;
      const service = yield* ServicePlatform;
      yield* repo.createIfMissing({
        sessionId: SESSION_ID,
        customerName: "Pat Jordan",
        phoneNumber: "+1-555-0199",
        email: null,
        zipCode: "60601",
      });

      const booked = yield* service.bookAppointment({
        sessionId: SESSION_ID,
        slotId: SLOT_ID,
        customerName: "Pat Jordan",
        phoneNumber: "+1-555-0199",
        zipCode: "60601",
        applianceType: "refrigerator",
      });

      expect(booked.appointment.slotId).toBe(SLOT_ID);
      expect(booked.appointment.technicianName).toBe("Jordan Price");
      expect(booked.session.status).toBe("scheduled");
      expect(booked.session.appointment?.slotId).toBe(SLOT_ID);

      const session = yield* service.getCallSession(SESSION_ID);
      expect(session.status).toBe("scheduled");
      expect(session.appointment?.confirmationCode.startsWith("svc-")).toBe(true);

      const dashboard = yield* service.getDashboardSnapshot;
      expect(
        dashboard.sessions.some((item) => item.id === SESSION_ID && item.status === "scheduled"),
      )
        .toBe(true);
      expect(dashboard.upcomingAppointments.some((item) => item.slotId === SLOT_ID)).toBe(true);
    }).pipe(
      withTransactionRollback,
      Effect.provide(TestServiceLayer),
      Effect.provide(TestRepoLayer),
      Effect.provide(PgTest),
    ));

  it.effect("creates an upload link and exposes it from the session and dashboard state", () =>
    Effect.gen(function*() {
      const repo = yield* CallSessionRepo;
      const service = yield* ServicePlatform;
      yield* repo.createIfMissing({
        sessionId: SESSION_ID,
        customerName: "Pat Jordan",
        phoneNumber: "+1-555-0199",
        email: null,
        zipCode: "60601",
      });

      const created = yield* service.createUploadLink(SESSION_ID, "pat@example.com");

      expect(created.uploadSession.status).toBe("pending");
      expect(created.uploadSession.uploadUrl.endsWith(`/upload/${created.uploadSession.token}`))
        .toBe(true);
      expect(created.deliveryPreviewUrl).toBe(created.uploadSession.uploadUrl);
      expect(created.emailDelivery.to).toBe("pat@example.com");

      const uploaded = yield* service.getUploadSession(created.uploadSession.token);
      expect(uploaded.status).toBe("pending");

      const session = yield* service.getCallSession(SESSION_ID);
      expect(session.status).toBe("awaiting_upload");
      expect(session.uploadSessions).toHaveLength(1);
      expect(session.uploadSessions[0]?.token).toBe(created.uploadSession.token);

      const dashboard = yield* service.getDashboardSnapshot;
      expect(dashboard.recentEmailDeliveries.some((item) => item.relatedSessionId === SESSION_ID))
        .toBe(true);
    }).pipe(
      withTransactionRollback,
      Effect.provide(TestServiceLayer),
      Effect.provide(TestRepoLayer),
      Effect.provide(PgTest),
    ));

  it.effect("stores an upload and persists the analyzed result", () =>
    Effect.gen(function*() {
      const repo = yield* CallSessionRepo;
      const service = yield* ServicePlatform;
      yield* repo.createIfMissing({
        sessionId: SESSION_ID,
        customerName: "Pat Jordan",
        phoneNumber: "+1-555-0199",
        email: null,
        zipCode: "60601",
      });

      const created = yield* service.createUploadLink(SESSION_ID, "pat@example.com");
      const stagedFile = path.join(UploadDirectory, "staged-upload.jpg");
      yield* Effect.tryPromise(() => writeFile(stagedFile, Buffer.from("fake-image-data"))).pipe(
        Effect.orDie,
      );

      const stored = yield* service.storeUpload(created.uploadSession.token, {
        path: stagedFile,
        name: "fridge.jpg",
      });

      expect(stored.status).toBe("analyzed");
      expect(stored.analysisSummary).toContain("dust accumulation");
      expect(stored.recognizedApplianceType).toBe("refrigerator");
      expect(stored.visibleSignals).toEqual([{
        key: "dust_buildup",
        detail: "Visible dust and lint around the condenser vent.",
      }]);

      const reloaded = yield* service.getUploadSession(created.uploadSession.token);
      expect(reloaded.status).toBe("analyzed");
      expect(reloaded.visibleSignals).toHaveLength(1);
    }).pipe(
      withTransactionRollback,
      Effect.provide(TestServiceLayer),
      Effect.provide(TestRepoLayer),
      Effect.provide(PgTest),
    ));
});
