import { AppConfig } from "@/config.js";
import { PgLive } from "@/db/pg-live.js";
import {
  ApplianceType,
  CallRunId,
  CallSessionId,
  CallSessionSummary,
  SessionNotFound,
} from "@app/domain/service-contract";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { SqlSchema } from "effect/unstable/sql";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import {
  CallSessionModel,
  GuidanceStepsSchema,
  RecommendedSlotRow,
  TechnicianLoadRow,
  TranscriptSchema,
  TroubleSignalSchema,
  UploadSessionRow,
} from "./call-session-model.js";
import {
  normalizeAssistantReplyText,
  normalizeTranscript,
  normalizeZipCode,
} from "./call-session-normalization.js";

export class CallSessionRepo extends Context.Service<CallSessionRepo, {
  readonly findById: (
    sessionId: typeof CallSessionId.Type,
  ) => Effect.Effect<typeof CallSessionModel.Type, SessionNotFound>;
  readonly findOption: (
    sessionId: typeof CallSessionId.Type,
  ) => Effect.Effect<Option.Option<typeof CallSessionModel.Type>>;
  readonly createIfMissing: (args: {
    readonly sessionId: typeof CallSessionId.Type;
    readonly customerName: string | null;
    readonly phoneNumber: string | null;
    readonly email: string | null;
    readonly zipCode: string | null;
  }) => Effect.Effect<typeof CallSessionModel.Type>;
  readonly startRun: (args: {
    readonly sessionId: typeof CallSessionId.Type;
    readonly runId: typeof CallRunId.Type;
  }) => Effect.Effect<boolean>;
  readonly finishRun: (args: {
    readonly sessionId: typeof CallSessionId.Type;
    readonly runId: typeof CallRunId.Type;
    readonly customerName: string;
    readonly phoneNumber: string;
    readonly email: string | null;
    readonly zipCode: string | null;
    readonly applianceType: typeof ApplianceType.Type | null;
    readonly status: typeof CallSessionModel.Type.status;
    readonly transcript: typeof CallSessionModel.Type.transcript;
    readonly symptomSummary: typeof CallSessionModel.Type.symptomSummary;
    readonly nextSteps: typeof CallSessionModel.Type.nextSteps;
    readonly latestAssistantMessage: string;
  }) => Effect.Effect<void>;
  readonly clearActiveRun: (args: {
    readonly sessionId: typeof CallSessionId.Type;
    readonly runId: typeof CallRunId.Type;
  }) => Effect.Effect<void>;
  readonly listRecent: Effect.Effect<ReadonlyArray<typeof CallSessionSummary.Type>>;
  readonly listRecommendedSlots: (
    zipCode: string | null,
    applianceType: typeof ApplianceType.Type | null,
  ) => Effect.Effect<ReadonlyArray<typeof RecommendedSlotRow.Type>>;
  readonly listTechnicianLoad: Effect.Effect<ReadonlyArray<typeof TechnicianLoadRow.Type>>;
  readonly listUploadSessions: (
    sessionId: typeof CallSessionId.Type,
  ) => Effect.Effect<ReadonlyArray<typeof UploadSessionRow.Type>>;
}>()("CallSessionRepo", {
  make: Effect.gen(function*() {
    const config = yield* AppConfig;
    const sql = yield* SqlClient;

    const normalizeCallSession = (session: typeof CallSessionModel.Type) =>
      new CallSessionModel({
        ...session,
        zipCode: normalizeZipCode(session.zipCode),
        transcript: normalizeTranscript(session.transcript),
        latestAssistantMessage: normalizeAssistantReplyText(session.latestAssistantMessage),
      });

    const normalizeCallSessionSummary = (session: typeof CallSessionSummary.Type) => ({
      ...session,
      latestAssistantMessage: normalizeAssistantReplyText(session.latestAssistantMessage),
    });

    const findByIdQuery = SqlSchema.findOneOption({
      Request: Schema.Struct({ sessionId: CallSessionId }),
      Result: CallSessionModel,
      execute: ({ sessionId }) =>
        sql`
          SELECT
            id,
            customer_name,
            phone_number,
            email,
            zip_code,
            appliance_type,
            status,
            transcript::text AS transcript,
            symptom_summary::text AS symptom_summary,
            next_steps::text AS next_steps,
            latest_assistant_message,
            appointment_id,
            active_run_id,
            created_at,
            updated_at
          FROM call_sessions
          WHERE id = ${sessionId}
        `,
    });

    const insertQuery = SqlSchema.findOne({
      Request: Schema.Struct({
        id: CallSessionId,
        customerName: Schema.String,
        phoneNumber: Schema.String,
        email: Schema.NullOr(Schema.String),
        zipCode: Schema.NullOr(Schema.String),
        applianceType: Schema.NullOr(ApplianceType),
        status: CallSessionModel.fields.status,
        transcript: TranscriptSchema,
        symptomSummary: TroubleSignalSchema,
        nextSteps: GuidanceStepsSchema,
        latestAssistantMessage: Schema.String,
        appointmentId: Schema.NullOr(Schema.String),
        activeRunId: Schema.NullOr(CallRunId),
      }),
      Result: CallSessionModel,
      execute: ({
        id,
        customerName,
        phoneNumber,
        email,
        zipCode,
        applianceType,
        status,
        transcript,
        symptomSummary,
        nextSteps,
        latestAssistantMessage,
        appointmentId,
        activeRunId,
      }) =>
        sql`
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
            latest_assistant_message,
            appointment_id,
            active_run_id
          )
          VALUES (
            ${id},
            ${customerName},
            ${phoneNumber},
            ${email},
            ${zipCode},
            ${applianceType},
            ${status},
            ${JSON.stringify(transcript)}::jsonb,
            ${JSON.stringify(symptomSummary)}::jsonb,
            ${JSON.stringify(nextSteps)}::jsonb,
            ${latestAssistantMessage},
            ${appointmentId},
            ${activeRunId}
          )
          RETURNING
            id,
            customer_name,
            phone_number,
            email,
            zip_code,
            appliance_type,
            status,
            transcript::text AS transcript,
            symptom_summary::text AS symptom_summary,
            next_steps::text AS next_steps,
            latest_assistant_message,
            appointment_id,
            active_run_id,
            created_at,
            updated_at
        `,
    });

    const startRunQuery = SqlSchema.findOneOption({
      Request: Schema.Struct({ sessionId: CallSessionId, runId: CallRunId }),
      Result: Schema.Struct({ id: CallSessionId }),
      execute: ({ sessionId, runId }) =>
        sql`
          UPDATE call_sessions
          SET active_run_id = ${runId}, updated_at = NOW()
          WHERE id = ${sessionId} AND active_run_id IS NULL
          RETURNING id
        `,
    });

    const finishRunQuery = SqlSchema.void({
      Request: Schema.Struct({
        sessionId: CallSessionId,
        runId: CallRunId,
        customerName: Schema.String,
        phoneNumber: Schema.String,
        email: Schema.NullOr(Schema.String),
        zipCode: Schema.NullOr(Schema.String),
        applianceType: Schema.NullOr(ApplianceType),
        status: CallSessionModel.fields.status,
        transcript: TranscriptSchema,
        symptomSummary: TroubleSignalSchema,
        nextSteps: GuidanceStepsSchema,
        latestAssistantMessage: Schema.String,
      }),
      execute: (args) =>
        sql`
          UPDATE call_sessions
          SET
            customer_name = ${args.customerName},
            phone_number = ${args.phoneNumber},
            email = ${args.email},
            zip_code = ${args.zipCode},
            appliance_type = ${args.applianceType},
            status = ${args.status},
            transcript = ${JSON.stringify(args.transcript)}::jsonb,
            symptom_summary = ${JSON.stringify(args.symptomSummary)}::jsonb,
            next_steps = ${JSON.stringify(args.nextSteps)}::jsonb,
            latest_assistant_message = ${args.latestAssistantMessage},
            active_run_id = NULL,
            updated_at = NOW()
          WHERE id = ${args.sessionId} AND active_run_id = ${args.runId}
        `,
    });

    const clearActiveRunQuery = SqlSchema.void({
      Request: Schema.Struct({ sessionId: CallSessionId, runId: CallRunId }),
      execute: ({ sessionId, runId }) =>
        sql`
          UPDATE call_sessions
          SET active_run_id = NULL, updated_at = NOW()
          WHERE id = ${sessionId} AND active_run_id = ${runId}
        `,
    });

    const listRecentQuery = SqlSchema.findAll({
      Request: Schema.Struct({}),
      Result: CallSessionSummary,
      execute: () =>
        sql`
          SELECT
            id,
            customer_name,
            appliance_type,
            status,
            latest_assistant_message AS latest_assistant_message,
            active_run_id,
            updated_at::text AS updated_at
          FROM call_sessions
          ORDER BY updated_at DESC
          LIMIT 10
        `,
    });

    const recommendedSlotsQuery = SqlSchema.findAll({
      Request: Schema.Struct({
        zipCode: Schema.String,
        applianceType: ApplianceType,
      }),
      Result: RecommendedSlotRow,
      execute: ({ zipCode, applianceType }) =>
        sql`
          SELECT
            availability_slots.id AS id,
            availability_slots.technician_id AS technician_id,
            technicians.name AS technician_name,
            availability_slots.starts_at AS starts_at,
            availability_slots.ends_at AS ends_at,
            availability_slots.appliance_type AS appliance_type,
            availability_slots.zip_code AS zip_code
          FROM availability_slots
          INNER JOIN technicians ON technicians.id = availability_slots.technician_id
          WHERE availability_slots.booked_appointment_id IS NULL
            AND availability_slots.zip_code = ${zipCode}
            AND availability_slots.appliance_type = ${applianceType}
          ORDER BY availability_slots.starts_at ASC
          LIMIT 4
        `,
    });

    const technicianLoadQuery = SqlSchema.findAll({
      Request: Schema.Struct({}),
      Result: TechnicianLoadRow,
      execute: () =>
        sql`
          SELECT
            technicians.id AS technician_id,
            technicians.name AS technician_name,
            COUNT(availability_slots.id) FILTER (WHERE availability_slots.booked_appointment_id IS NULL)::int AS open_slots,
            ARRAY_AGG(DISTINCT technician_specialties.appliance_type) AS specialties,
            ARRAY_AGG(DISTINCT technician_service_zip_codes.zip_code) AS zip_codes
          FROM technicians
          LEFT JOIN technician_specialties ON technician_specialties.technician_id = technicians.id
          LEFT JOIN technician_service_zip_codes ON technician_service_zip_codes.technician_id = technicians.id
          LEFT JOIN availability_slots ON availability_slots.technician_id = technicians.id
          GROUP BY technicians.id, technicians.name
          ORDER BY technicians.name ASC
        `,
    });

    const uploadSessionsQuery = SqlSchema.findAll({
      Request: Schema.Struct({ sessionId: CallSessionId }),
      Result: UploadSessionRow,
      execute: ({ sessionId }) =>
        sql`
          SELECT
            token,
            status,
            email,
            ${config.publicAppOrigin} || '/upload/' || token AS upload_url,
            uploaded_at,
            analysis_summary,
            recognized_appliance_type,
            visible_signals,
            expires_at
          FROM upload_sessions
          WHERE call_session_id = ${sessionId}
          ORDER BY created_at DESC
        `,
    });

    const insertSession = (args: {
      readonly sessionId: typeof CallSessionId.Type;
      readonly customerName: string | null;
      readonly phoneNumber: string | null;
      readonly email: string | null;
      readonly zipCode: string | null;
    }): Effect.Effect<typeof CallSessionModel.Type> =>
      insertQuery({
        id: args.sessionId,
        customerName: args.customerName ?? "Caller",
        phoneNumber: args.phoneNumber ?? "unknown-caller",
        email: args.email,
        zipCode: args.zipCode,
        applianceType: null,
        status: "intake",
        transcript: [],
        symptomSummary: [],
        nextSteps: [],
        latestAssistantMessage: "Call started.",
        appointmentId: null,
        activeRunId: null,
      }).pipe(
        Effect.catchTags({
          SchemaError: Effect.die,
          SqlError: Effect.die,
          NoSuchElementError: Effect.die,
        }),
      );

    return {
      findById: (sessionId) =>
        findByIdQuery({ sessionId }).pipe(
          Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
          Effect.map(Option.map(normalizeCallSession)),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new SessionNotFound({ sessionId })),
              onSome: Effect.succeed,
            }),
          ),
        ),
      findOption: (sessionId) =>
        findByIdQuery({ sessionId }).pipe(
          Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
          Effect.map(Option.map(normalizeCallSession)),
        ),
      createIfMissing: (args) =>
        findByIdQuery({ sessionId: args.sessionId }).pipe(
          Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
          Effect.map(Option.map(normalizeCallSession)),
          Effect.flatMap(
            Option.match({
              onNone: () => insertSession(args),
              onSome: Effect.succeed,
            }),
          ),
        ),
      startRun: ({ sessionId, runId }) =>
        startRunQuery({ sessionId, runId }).pipe(
          Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
          Effect.map(Option.isSome),
        ),
      finishRun: (args) =>
        finishRunQuery(args).pipe(
          Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
        ),
      clearActiveRun: ({ sessionId, runId }) =>
        clearActiveRunQuery({ sessionId, runId }).pipe(
          Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
        ),
      listRecent: listRecentQuery({}).pipe(
        Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
        Effect.map(Arr.map(normalizeCallSessionSummary)),
      ),
      listRecommendedSlots: (zipCode, applianceType) =>
        zipCode === null || applianceType === null
          ? Effect.succeed([])
          : recommendedSlotsQuery({ zipCode, applianceType }).pipe(
            Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
          ),
      listTechnicianLoad: technicianLoadQuery({}).pipe(
        Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
      ),
      listUploadSessions: (sessionId) =>
        uploadSessionsQuery({ sessionId }).pipe(
          Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
        ),
    };
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(Layer.provide(PgLive));
}
