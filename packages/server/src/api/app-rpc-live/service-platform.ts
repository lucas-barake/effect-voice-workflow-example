import { AppConfig } from "@/config.js";
import { PgLive } from "@/db/pg-live.js";
import {
  ApplianceType,
  Appointment,
  AvailableSlot,
  BookAppointmentInput,
  BookAppointmentOutput,
  CallSessionId,
  CallSessionSnapshot,
  CallSessionSummary,
  CreateUploadLinkOutput,
  EmailDelivery,
  NoMatchingTechnician,
  SessionNotFound,
  SlotAlreadyBooked,
  TechnicianLoad,
  TechnicianSummary,
  TroubleSignal,
  UploadSessionExpired,
  UploadSessionNotFound,
  type UploadSessionSnapshot,
  UploadStatus,
  UploadToken,
} from "@app/domain/service-contract";
import { PgClient } from "@effect/sql-pg";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as AiError from "effect/unstable/ai/AiError";
import { SqlSchema } from "effect/unstable/sql";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { CallSessionModel } from "./call-session-model.js";
import { CallSessionRepo } from "./call-session-repo.js";
import { moveUploadedFile } from "./upload-file.js";
import { VisionDiagnosticAgent } from "./vision-diagnostic-agent.js";

const asIso = (value: string | Date) =>
  DateTime.formatIso(
    typeof value === "string" ? DateTime.makeUnsafe(value) : DateTime.fromDateUnsafe(value),
  );

const buildConfirmationCode = () => `svc-${randomBytes(3).toString("hex")}`;
const buildOpaqueUploadKey = (filename: string) =>
  `${randomUUID()}${path.extname(filename).toLowerCase()}`;

const AppointmentRow = Schema.Struct({
  id: Appointment.fields.id,
  slotId: AvailableSlot.fields.id,
  technicianId: TechnicianSummary.fields.id,
  technicianName: Schema.String,
  startsAt: Schema.String,
  endsAt: Schema.String,
  applianceType: ApplianceType,
  zipCode: Schema.String,
  confirmationCode: Schema.String,
}).annotate({ identifier: "AppointmentRow" });

const UploadSessionDbRow = Schema.Struct({
  token: UploadToken,
  status: UploadStatus,
  email: Schema.String,
  analysisSummary: Schema.NullOr(Schema.String),
  recognizedApplianceType: Schema.NullOr(ApplianceType),
  visibleSignals: Schema.fromJsonString(Schema.Array(TroubleSignal)),
  uploadedAt: Schema.NullOr(Schema.String),
  expiresAt: Schema.String,
}).annotate({ identifier: "UploadSessionDbRow" });

const EmailDeliveryRow = Schema.Struct({
  id: Schema.String,
  relatedSessionId: CallSessionId,
  to: Schema.String,
  subject: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
}).annotate({ identifier: "EmailDeliveryRow" });

const SlotBookingRow = Schema.Struct({
  id: AvailableSlot.fields.id,
  technicianId: TechnicianSummary.fields.id,
  technicianName: Schema.String,
  startsAt: Schema.String,
  endsAt: Schema.String,
  applianceType: ApplianceType,
  zipCode: Schema.String,
  bookedAppointmentId: Schema.NullOr(Appointment.fields.id),
}).annotate({ identifier: "SlotBookingRow" });

const CallApplianceRow = Schema.Struct({
  applianceType: Schema.NullOr(ApplianceType),
}).annotate({ identifier: "CallApplianceRow" });

const IdRow = Schema.Struct({
  id: Schema.String,
}).annotate({ identifier: "IdRow" });

const mapAppointment = (row: typeof AppointmentRow.Type): Appointment => ({
  id: row.id,
  slotId: row.slotId,
  technicianId: row.technicianId,
  technicianName: row.technicianName,
  startsAt: asIso(row.startsAt),
  endsAt: asIso(row.endsAt),
  applianceType: row.applianceType,
  zipCode: row.zipCode,
  confirmationCode: row.confirmationCode,
});

const mapUploadSession = (config: {
  readonly publicAppOrigin: string;
}, row: typeof UploadSessionDbRow.Type): UploadSessionSnapshot => ({
  token: row.token,
  status: row.status,
  email: row.email,
  uploadUrl: `${config.publicAppOrigin}/upload/${row.token}`,
  uploadedAt: row.uploadedAt === null ? null : asIso(row.uploadedAt),
  analysisSummary: row.analysisSummary,
  recognizedApplianceType: row.recognizedApplianceType,
  visibleSignals: row.visibleSignals,
  expiresAt: asIso(row.expiresAt),
});

const mapEmailDelivery = (row: typeof EmailDeliveryRow.Type): EmailDelivery => ({
  id: row.id,
  to: row.to,
  subject: row.subject,
  body: row.body,
  relatedSessionId: row.relatedSessionId,
  createdAt: asIso(row.createdAt),
});

export class ServicePlatform extends Context.Service<ServicePlatform, {
  readonly getDashboardSnapshot: Effect.Effect<{
    readonly sessions: ReadonlyArray<CallSessionSummary>;
    readonly technicianLoad: ReadonlyArray<TechnicianLoad>;
    readonly upcomingAppointments: ReadonlyArray<Appointment>;
    readonly recentEmailDeliveries: ReadonlyArray<EmailDelivery>;
  }>;
  readonly getCallSession: (
    sessionId: typeof CallSessionId.Type,
  ) => Effect.Effect<CallSessionSnapshot, SessionNotFound>;
  readonly bookAppointment: (
    input: BookAppointmentInput,
  ) => Effect.Effect<
    BookAppointmentOutput,
    SessionNotFound | NoMatchingTechnician | SlotAlreadyBooked
  >;
  readonly createUploadLink: (
    sessionId: typeof CallSessionId.Type,
    email: string,
  ) => Effect.Effect<CreateUploadLinkOutput, SessionNotFound>;
  readonly getUploadSession: (
    token: typeof UploadToken.Type,
  ) => Effect.Effect<UploadSessionSnapshot, UploadSessionNotFound | UploadSessionExpired>;
  readonly storeUpload: (
    token: typeof UploadToken.Type,
    file: {
      readonly path: string;
      readonly name: string;
    },
  ) => Effect.Effect<
    UploadSessionSnapshot,
    UploadSessionNotFound | UploadSessionExpired | AiError.AiError | Error
  >;
}>()("ServicePlatform") {
  static make = Effect.gen(function*() {
    const config = yield* AppConfig;
    const sql = yield* PgClient.PgClient;
    const repo = yield* CallSessionRepo;
    const visionDiagnosticAgent = yield* VisionDiagnosticAgent;

    const getAppointmentQuery = SqlSchema.findOneOption({
      Request: Schema.Struct({ appointmentId: Schema.String }),
      Result: AppointmentRow,
      execute: ({ appointmentId }) =>
        sql`
          SELECT
            appointments.id AS id,
            appointments.slot_id AS slot_id,
            appointments.technician_id AS technician_id,
            technicians.name AS technician_name,
            appointments.starts_at AS starts_at,
            appointments.ends_at AS ends_at,
            appointments.appliance_type AS appliance_type,
            appointments.zip_code AS zip_code,
            appointments.confirmation_code AS confirmation_code
          FROM appointments
          INNER JOIN technicians ON technicians.id = appointments.technician_id
          WHERE appointments.id = ${appointmentId}
        `,
    });

    const getUploadSessionQuery = SqlSchema.findOneOption({
      Request: Schema.Struct({ token: UploadToken }),
      Result: UploadSessionDbRow,
      execute: ({ token }) =>
        sql`
          SELECT
            token,
            status,
            email,
            analysis_summary AS analysis_summary,
            recognized_appliance_type AS recognized_appliance_type,
            visible_signals::text AS visible_signals,
            uploaded_at AS uploaded_at,
            expires_at AS expires_at
          FROM upload_sessions
          WHERE token = ${token}
        `,
    });

    const listAppointmentsQuery = SqlSchema.findAll({
      Request: Schema.Struct({}),
      Result: AppointmentRow,
      execute: () =>
        sql`
          SELECT
            appointments.id AS id,
            appointments.slot_id AS slot_id,
            appointments.technician_id AS technician_id,
            technicians.name AS technician_name,
            appointments.starts_at AS starts_at,
            appointments.ends_at AS ends_at,
            appointments.appliance_type AS appliance_type,
            appointments.zip_code AS zip_code,
            appointments.confirmation_code AS confirmation_code
          FROM appointments
          INNER JOIN technicians ON technicians.id = appointments.technician_id
          ORDER BY appointments.starts_at ASC
          LIMIT 10
        `,
    });

    const listEmailDeliveriesQuery = SqlSchema.findAll({
      Request: Schema.Struct({}),
      Result: EmailDeliveryRow,
      execute: () =>
        sql`
          SELECT
            id,
            call_session_id AS related_session_id,
            recipient_email AS to,
            subject,
            body,
            created_at AS created_at
          FROM email_deliveries
          ORDER BY created_at DESC
          LIMIT 10
        `,
    });

    const getSlotBookingQuery = SqlSchema.findOneOption({
      Request: Schema.Struct({ slotId: AvailableSlot.fields.id }),
      Result: SlotBookingRow,
      execute: ({ slotId }) =>
        sql`
          SELECT
            availability_slots.id AS id,
            availability_slots.technician_id AS technician_id,
            technicians.name AS technician_name,
            availability_slots.starts_at AS starts_at,
            availability_slots.ends_at AS ends_at,
            availability_slots.appliance_type AS appliance_type,
            availability_slots.zip_code AS zip_code,
            availability_slots.booked_appointment_id AS booked_appointment_id
          FROM availability_slots
          INNER JOIN technicians ON technicians.id = availability_slots.technician_id
          WHERE availability_slots.id = ${slotId}
        `,
    });

    const getCallApplianceQuery = SqlSchema.findOneOption({
      Request: Schema.Struct({ token: UploadToken }),
      Result: CallApplianceRow,
      execute: ({ token }) =>
        sql`
          SELECT call_sessions.appliance_type AS appliance_type
          FROM call_sessions
          INNER JOIN upload_sessions ON upload_sessions.call_session_id = call_sessions.id
          WHERE upload_sessions.token = ${token}
        `,
    });

    const updateBookedSlotQuery = SqlSchema.findAll({
      Request: Schema.Struct({
        slotId: AvailableSlot.fields.id,
        appointmentId: Appointment.fields.id,
      }),
      Result: IdRow,
      execute: ({ slotId, appointmentId }) =>
        sql`
          UPDATE availability_slots
          SET booked_appointment_id = ${appointmentId}
          WHERE id = ${slotId}
            AND booked_appointment_id IS NULL
          RETURNING id
        `,
    });

    const updateScheduledSessionQuery = SqlSchema.findOneOption({
      Request: Schema.Struct({
        sessionId: CallSessionId,
        appointmentId: Appointment.fields.id,
        customerName: Schema.String,
        phoneNumber: Schema.String,
        zipCode: Schema.String,
        applianceType: ApplianceType,
      }),
      Result: CallSessionModel,
      execute: ({ sessionId, appointmentId, customerName, phoneNumber, zipCode, applianceType }) =>
        sql`
          UPDATE call_sessions
          SET
            customer_name = ${customerName},
            phone_number = ${phoneNumber},
            zip_code = ${zipCode},
            appliance_type = ${applianceType},
            status = 'scheduled',
            appointment_id = ${appointmentId},
            updated_at = NOW()
          WHERE id = ${sessionId}
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

    const insertUploadSessionQuery = SqlSchema.findOneOption({
      Request: Schema.Struct({
        token: UploadToken,
        callSessionId: CallSessionId,
        email: Schema.String,
        status: UploadStatus,
        expiresAt: Schema.String,
      }),
      Result: UploadSessionDbRow,
      execute: ({ token, callSessionId, email, status, expiresAt }) =>
        sql`
          INSERT INTO upload_sessions ${
          sql.insert({
            token,
            callSessionId,
            email,
            status,
            expiresAt,
          })
        }
          RETURNING
            token,
            status,
            email,
            analysis_summary AS analysis_summary,
            recognized_appliance_type AS recognized_appliance_type,
            visible_signals::text AS visible_signals,
            uploaded_at AS uploaded_at,
            expires_at AS expires_at
        `,
    });

    const updateAwaitingUploadSessionQuery = SqlSchema.void({
      Request: Schema.Struct({
        sessionId: CallSessionId,
        email: Schema.String,
      }),
      execute: ({ sessionId, email }) =>
        sql`
          UPDATE call_sessions
          SET
            email = ${email},
            status = 'awaiting_upload',
            updated_at = NOW()
          WHERE id = ${sessionId}
        `,
    });

    const insertEmailDeliveryQuery = SqlSchema.findOneOption({
      Request: Schema.Struct({
        id: Schema.String,
        callSessionId: CallSessionId,
        recipientEmail: Schema.String,
        subject: Schema.String,
        body: Schema.String,
      }),
      Result: EmailDeliveryRow,
      execute: (request) =>
        sql`
          INSERT INTO email_deliveries ${sql.insert(request)}
          RETURNING
            id,
            call_session_id AS related_session_id,
            recipient_email AS to,
            subject,
            body,
            created_at AS created_at
        `,
    });

    const updateAnalyzedUploadQuery = SqlSchema.findOneOption({
      Request: Schema.Struct({
        token: UploadToken,
        uploadPath: Schema.String,
        analysisSummary: Schema.String,
        recognizedApplianceType: Schema.NullOr(ApplianceType),
        visibleSignals: Schema.Array(TroubleSignal),
      }),
      Result: UploadSessionDbRow,
      execute: ({ token, uploadPath, analysisSummary, recognizedApplianceType, visibleSignals }) =>
        sql`
          UPDATE upload_sessions
          SET
            status = 'analyzed',
            upload_path = ${uploadPath},
            analysis_summary = ${analysisSummary},
            recognized_appliance_type = ${recognizedApplianceType},
            visible_signals = ${JSON.stringify(visibleSignals)}::jsonb,
            uploaded_at = NOW()
          WHERE token = ${token}
          RETURNING
            token,
            status,
            email,
            analysis_summary AS analysis_summary,
            recognized_appliance_type AS recognized_appliance_type,
            visible_signals::text AS visible_signals,
            uploaded_at AS uploaded_at,
            expires_at AS expires_at
        `,
    });

    const buildCallSessionSnapshot = (row: typeof CallSessionModel.Type) =>
      Effect.gen(function*() {
        const appointment = row.appointmentId === null
          ? null
          : yield* getAppointmentQuery({ appointmentId: row.appointmentId }).pipe(
            Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
            Effect.map(Option.match({ onNone: () => null, onSome: mapAppointment })),
          );
        const uploadSessions = yield* repo.listUploadSessions(row.id);
        const recommendedSlots = yield* repo.listRecommendedSlots(row.zipCode, row.applianceType);
        return {
          id: row.id,
          activeRunId: row.activeRunId,
          customerName: row.customerName,
          phoneNumber: row.phoneNumber,
          email: row.email,
          zipCode: row.zipCode,
          applianceType: row.applianceType,
          status: row.status,
          symptomSummary: row.symptomSummary,
          transcript: row.transcript,
          nextSteps: row.nextSteps,
          recommendedSlots,
          appointment,
          uploadSessions,
          updatedAt: DateTime.formatIso(row.updatedAt),
        };
      });

    const getCallSession = (sessionId: typeof CallSessionId.Type) =>
      repo.findById(sessionId).pipe(Effect.andThen(buildCallSessionSnapshot));

    const getUploadSession = (token: typeof UploadToken.Type) =>
      Effect.gen(function*() {
        const rowOption = yield* getUploadSessionQuery({ token }).pipe(
          Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
        );
        if (Option.isNone(rowOption)) {
          return yield* new UploadSessionNotFound({ token });
        }
        const row = rowOption.value;
        if (yield* DateTime.isPast(DateTime.makeUnsafe(row.expiresAt))) {
          yield* sql`
            UPDATE upload_sessions
            SET status = 'expired'
            WHERE token = ${token}
          `.pipe(Effect.orDie);
          return yield* new UploadSessionExpired({ token });
        }
        return mapUploadSession(config, row);
      });

    const getDashboardSnapshot = Effect.gen(function*() {
      const sessionRows = yield* repo.listRecent;
      const technicianLoad = yield* repo.listTechnicianLoad;
      const appointmentRows = yield* listAppointmentsQuery({}).pipe(
        Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
      );
      const emailDeliveryRows = yield* listEmailDeliveriesQuery({}).pipe(
        Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
      );

      return {
        sessions: sessionRows,
        technicianLoad,
        upcomingAppointments: appointmentRows.map(mapAppointment),
        recentEmailDeliveries: emailDeliveryRows.map(mapEmailDelivery),
      };
    });

    const bookAppointment = (input: BookAppointmentInput) =>
      Effect.gen(function*() {
        yield* repo.findById(input.sessionId);
        const slotRowOption = yield* getSlotBookingQuery({ slotId: input.slotId }).pipe(
          Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
        );

        if (Option.isNone(slotRowOption)) {
          return yield* new NoMatchingTechnician({
            applianceType: input.applianceType,
            zipCode: input.zipCode,
          });
        }
        const slotRow = slotRowOption.value;
        if (slotRow.bookedAppointmentId !== null) {
          return yield* new SlotAlreadyBooked({ slotId: input.slotId });
        }
        if (slotRow.applianceType !== input.applianceType || slotRow.zipCode !== input.zipCode) {
          return yield* new NoMatchingTechnician({
            applianceType: input.applianceType,
            zipCode: input.zipCode,
          });
        }

        const appointmentId = Appointment.fields.id.make(randomUUID());
        const confirmationCode = buildConfirmationCode();

        return yield* Effect.gen(function*() {
          yield* sql`
            INSERT INTO appointments ${
            sql.insert({
              id: appointmentId,
              callSessionId: input.sessionId,
              slotId: input.slotId,
              technicianId: slotRow.technicianId,
              customerName: input.customerName,
              phoneNumber: input.phoneNumber,
              zipCode: input.zipCode,
              applianceType: input.applianceType,
              startsAt: slotRow.startsAt,
              endsAt: slotRow.endsAt,
              confirmationCode,
            })
          }
          `.pipe(Effect.orDie);

          const updatedSlots = yield* updateBookedSlotQuery({
            slotId: input.slotId,
            appointmentId,
          }).pipe(Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }));

          if (updatedSlots.length === 0) {
            return yield* new SlotAlreadyBooked({ slotId: input.slotId });
          }

          const updatedSessionOption = yield* updateScheduledSessionQuery({
            sessionId: input.sessionId,
            appointmentId,
            customerName: input.customerName,
            phoneNumber: input.phoneNumber,
            zipCode: input.zipCode,
            applianceType: input.applianceType,
          }).pipe(Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }));

          const appointment = mapAppointment({
            id: appointmentId,
            slotId: input.slotId,
            technicianId: slotRow.technicianId,
            technicianName: slotRow.technicianName,
            startsAt: slotRow.startsAt,
            endsAt: slotRow.endsAt,
            applianceType: input.applianceType,
            zipCode: input.zipCode,
            confirmationCode,
          });

          if (Option.isNone(updatedSessionOption)) {
            return yield* Effect.die("appointment update session missing");
          }

          const session = yield* buildCallSessionSnapshot(updatedSessionOption.value);

          return {
            appointment,
            session,
          };
        }).pipe(sql.withTransaction, Effect.orDie);
      });

    const createUploadLink = (sessionId: typeof CallSessionId.Type, email: string) =>
      Effect.gen(function*() {
        yield* repo.findById(sessionId);

        const token = UploadToken.make(randomBytes(18).toString("base64url"));
        const expiresAt = DateTime.formatIso(DateTime.add(yield* DateTime.now, { days: 1 }));
        const deliveryPreviewUrl = `${config.publicAppOrigin}/upload/${token}`;
        const emailDeliveryId = randomUUID();
        const emailSubject = "Upload your appliance photo";
        const emailBody =
          `Open the secure upload link to continue the appliance diagnosis: ${deliveryPreviewUrl}`;

        const rowOption = yield* insertUploadSessionQuery({
          token,
          callSessionId: sessionId,
          email,
          status: "pending",
          expiresAt,
        }).pipe(Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }));

        yield* updateAwaitingUploadSessionQuery({
          sessionId,
          email,
        }).pipe(Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }));

        const emailDeliveryRowOption = yield* insertEmailDeliveryQuery({
          id: emailDeliveryId,
          callSessionId: sessionId,
          recipientEmail: email,
          subject: emailSubject,
          body: emailBody,
        }).pipe(Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }));

        if (Option.isNone(rowOption)) {
          return yield* Effect.die("upload session insert missing");
        }
        if (Option.isNone(emailDeliveryRowOption)) {
          return yield* Effect.die("email delivery insert missing");
        }

        const uploadSession = mapUploadSession(config, rowOption.value);
        return {
          uploadSession,
          deliveryPreviewUrl,
          emailDelivery: mapEmailDelivery(emailDeliveryRowOption.value),
        };
      });

    const storeUpload = (
      token: typeof UploadToken.Type,
      file: {
        readonly path: string;
        readonly name: string;
      },
    ) =>
      Effect.gen(function*() {
        yield* getUploadSession(token);

        const callRowOption = yield* getCallApplianceQuery({ token }).pipe(
          Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }),
        );
        const applianceType = Option.match(callRowOption, {
          onNone: () => null,
          onSome: (row) => row.applianceType,
        });
        const objectKey = buildOpaqueUploadKey(file.name);

        yield* Effect.tryPromise(() => mkdir(config.uploadDirectory, { recursive: true })).pipe(
          Effect.orDie,
        );
        yield* moveUploadedFile(file.path, path.join(config.uploadDirectory, objectKey));

        const analysis = yield* visionDiagnosticAgent.analyzeUpload({
          applianceType,
          filePath: path.join(config.uploadDirectory, objectKey),
          fileName: file.name,
        });

        const rowOption = yield* updateAnalyzedUploadQuery({
          token,
          uploadPath: objectKey,
          analysisSummary: analysis.analysisSummary,
          recognizedApplianceType: analysis.recognizedApplianceType,
          visibleSignals: [...analysis.visibleSignals],
        }).pipe(Effect.catchTags({ SchemaError: Effect.die, SqlError: Effect.die }));

        if (Option.isNone(rowOption)) {
          return yield* Effect.die("upload session update missing");
        }

        return mapUploadSession(config, rowOption.value);
      });

    return ServicePlatform.of({
      getDashboardSnapshot,
      getCallSession,
      bookAppointment,
      createUploadLink,
      getUploadSession,
      storeUpload,
    });
  });

  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(VisionDiagnosticAgent.layer),
    Layer.provide(CallSessionRepo.layer),
    Layer.provide(PgLive),
  );
}
