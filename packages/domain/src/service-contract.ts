import * as Schema from "effect/Schema";

export const ApplianceType = Schema.Literals([
  "washer",
  "dryer",
  "refrigerator",
  "dishwasher",
  "oven",
  "hvac",
]).annotate({ identifier: "ApplianceType" });
export type ApplianceType = typeof ApplianceType.Type;

export const SessionStatus = Schema.Literals([
  "intake",
  "diagnosing",
  "troubleshooting",
  "resolved",
  "ready_to_schedule",
  "scheduled",
  "awaiting_upload",
]).annotate({ identifier: "SessionStatus" });
export type SessionStatus = typeof SessionStatus.Type;

export const UploadStatus = Schema.Literals([
  "pending",
  "uploaded",
  "analyzed",
  "expired",
]).annotate({ identifier: "UploadStatus" });
export type UploadStatus = typeof UploadStatus.Type;

export const CallSessionId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("CallSessionId"),
).annotate({ identifier: "CallSessionId" });
export type CallSessionId = typeof CallSessionId.Type;

export const CallRunId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("CallRunId"),
).annotate({ identifier: "CallRunId" });
export type CallRunId = typeof CallRunId.Type;

export const TechnicianId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("TechnicianId"),
).annotate({ identifier: "TechnicianId" });
export type TechnicianId = typeof TechnicianId.Type;

export const SlotId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("SlotId"),
).annotate({ identifier: "SlotId" });
export type SlotId = typeof SlotId.Type;

export const AppointmentId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("AppointmentId"),
).annotate({ identifier: "AppointmentId" });
export type AppointmentId = typeof AppointmentId.Type;

export const UploadToken = Schema.String.pipe(
  Schema.check(Schema.isMinLength(20)),
  Schema.brand("UploadToken"),
).annotate({ identifier: "UploadToken" });
export type UploadToken = typeof UploadToken.Type;

export const TroubleSignal = Schema.Struct({
  key: Schema.String,
  detail: Schema.String,
}).annotate({ identifier: "TroubleSignal" });
export type TroubleSignal = typeof TroubleSignal.Type;

export const GuidanceStep = Schema.Struct({
  key: Schema.String,
  instruction: Schema.String,
  completionHint: Schema.String,
}).annotate({ identifier: "GuidanceStep" });
export type GuidanceStep = typeof GuidanceStep.Type;

export const TranscriptEntry = Schema.Struct({
  role: Schema.Literals(["caller", "assistant", "tool"]),
  message: Schema.String,
  at: Schema.String,
}).annotate({ identifier: "TranscriptEntry" });
export type TranscriptEntry = typeof TranscriptEntry.Type;

export const CallToolName = Schema.Literals([
  "lookup_recommended_slots",
  "lookup_technician_load",
  "lookup_upload_context",
]);
export type CallToolName = typeof CallToolName.Type;

export const CallRunWatchEvent = Schema.TaggedStruct("RunChanged", {
  runId: Schema.NullOr(CallRunId),
});
export type CallRunWatchEvent = typeof CallRunWatchEvent.Type;

export const CallRunEvent = Schema.Union([
  Schema.TaggedStruct("Chunk", { delta: Schema.String }),
  Schema.TaggedStruct("ReasoningChunk", { delta: Schema.String }),
  Schema.TaggedStruct("ToolStart", {
    toolName: CallToolName,
    input: Schema.String,
  }),
  Schema.TaggedStruct("ToolFailure", {
    toolName: CallToolName,
    output: Schema.String,
  }),
  Schema.TaggedStruct("ToolSuccess", {
    toolName: CallToolName,
    output: Schema.String,
  }),
  Schema.TaggedStruct("RunCompleted", {
    sessionId: CallSessionId,
    assistantMessage: Schema.String,
  }),
]);
export type CallRunEvent = typeof CallRunEvent.Type;

export const TechnicianSummary = Schema.Struct({
  id: TechnicianId,
  name: Schema.String,
  phoneNumber: Schema.String,
  specialties: Schema.Array(ApplianceType),
  serviceZipCodes: Schema.Array(Schema.String),
}).annotate({ identifier: "TechnicianSummary" });
export type TechnicianSummary = typeof TechnicianSummary.Type;

export const AvailableSlot = Schema.Struct({
  id: SlotId,
  technicianId: TechnicianId,
  technicianName: Schema.String,
  startsAt: Schema.String,
  endsAt: Schema.String,
  applianceType: ApplianceType,
  zipCode: Schema.String,
}).annotate({ identifier: "AvailableSlot" });
export type AvailableSlot = typeof AvailableSlot.Type;

export const Appointment = Schema.Struct({
  id: AppointmentId,
  slotId: SlotId,
  technicianId: TechnicianId,
  technicianName: Schema.String,
  startsAt: Schema.String,
  endsAt: Schema.String,
  applianceType: ApplianceType,
  zipCode: Schema.String,
  confirmationCode: Schema.String,
}).annotate({ identifier: "Appointment" });
export type Appointment = typeof Appointment.Type;

export const EmailDelivery = Schema.Struct({
  id: Schema.String,
  to: Schema.String,
  subject: Schema.String,
  body: Schema.String,
  relatedSessionId: CallSessionId,
  createdAt: Schema.String,
}).annotate({ identifier: "EmailDelivery" });
export type EmailDelivery = typeof EmailDelivery.Type;

export const UploadSessionSnapshot = Schema.Struct({
  token: UploadToken,
  status: UploadStatus,
  email: Schema.String,
  uploadUrl: Schema.String,
  uploadedAt: Schema.NullOr(Schema.String),
  analysisSummary: Schema.NullOr(Schema.String),
  recognizedApplianceType: Schema.NullOr(ApplianceType),
  visibleSignals: Schema.Array(TroubleSignal),
  expiresAt: Schema.String,
}).annotate({ identifier: "UploadSessionSnapshot" });
export type UploadSessionSnapshot = typeof UploadSessionSnapshot.Type;

export const CallSessionSnapshot = Schema.Struct({
  id: CallSessionId,
  activeRunId: Schema.NullOr(CallRunId),
  customerName: Schema.String,
  phoneNumber: Schema.String,
  email: Schema.NullOr(Schema.String),
  zipCode: Schema.NullOr(Schema.String),
  applianceType: Schema.NullOr(ApplianceType),
  status: SessionStatus,
  symptomSummary: Schema.Array(TroubleSignal),
  transcript: Schema.Array(TranscriptEntry),
  nextSteps: Schema.Array(GuidanceStep),
  recommendedSlots: Schema.Array(AvailableSlot),
  appointment: Schema.NullOr(Appointment),
  uploadSessions: Schema.Array(UploadSessionSnapshot),
  updatedAt: Schema.String,
}).annotate({ identifier: "CallSessionSnapshot" });
export type CallSessionSnapshot = typeof CallSessionSnapshot.Type;

export const CallSessionSummary = Schema.Struct({
  id: CallSessionId,
  activeRunId: Schema.NullOr(CallRunId),
  customerName: Schema.String,
  applianceType: Schema.NullOr(ApplianceType),
  status: SessionStatus,
  latestAssistantMessage: Schema.String,
  updatedAt: Schema.String,
}).annotate({ identifier: "CallSessionSummary" });
export type CallSessionSummary = typeof CallSessionSummary.Type;

export const TechnicianLoad = Schema.Struct({
  technicianId: TechnicianId,
  technicianName: Schema.String,
  openSlots: Schema.Number,
  specialties: Schema.Array(ApplianceType),
  zipCodes: Schema.Array(Schema.String),
}).annotate({ identifier: "TechnicianLoad" });
export type TechnicianLoad = typeof TechnicianLoad.Type;

export const DashboardSnapshot = Schema.Struct({
  sessions: Schema.Array(CallSessionSummary),
  technicianLoad: Schema.Array(TechnicianLoad),
  upcomingAppointments: Schema.Array(Appointment),
  recentEmailDeliveries: Schema.Array(EmailDelivery),
}).annotate({ identifier: "DashboardSnapshot" });
export type DashboardSnapshot = typeof DashboardSnapshot.Type;

export const SimulateCallTurnInput = Schema.Struct({
  sessionId: Schema.optional(Schema.NullOr(CallSessionId)),
  customerName: Schema.optional(Schema.NullOr(Schema.String)),
  phoneNumber: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.optional(Schema.NullOr(Schema.String)),
  zipCode: Schema.optional(Schema.NullOr(Schema.String)),
  utterance: Schema.String,
}).annotate({ identifier: "SimulateCallTurnInput" });
export type SimulateCallTurnInput = typeof SimulateCallTurnInput.Type;

export const StartCallRunInput = Schema.Struct({
  sessionId: Schema.optional(Schema.NullOr(CallSessionId)),
  customerName: Schema.optional(Schema.NullOr(Schema.String)),
  phoneNumber: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.optional(Schema.NullOr(Schema.String)),
  zipCode: Schema.optional(Schema.NullOr(Schema.String)),
  utterance: Schema.String,
}).annotate({ identifier: "StartCallRunInput" });
export type StartCallRunInput = typeof StartCallRunInput.Type;

export const SimulateCallTurnOutput = Schema.Struct({
  assistantMessage: Schema.String,
  session: CallSessionSnapshot,
}).annotate({ identifier: "SimulateCallTurnOutput" });
export type SimulateCallTurnOutput = typeof SimulateCallTurnOutput.Type;

export const StartCallRunOutput = Schema.Struct({
  runId: CallRunId,
  sessionId: CallSessionId,
}).annotate({ identifier: "StartCallRunOutput" });
export type StartCallRunOutput = typeof StartCallRunOutput.Type;

export const BookAppointmentInput = Schema.Struct({
  sessionId: CallSessionId,
  slotId: SlotId,
  customerName: Schema.String,
  phoneNumber: Schema.String,
  zipCode: Schema.String,
  applianceType: ApplianceType,
}).annotate({ identifier: "BookAppointmentInput" });
export type BookAppointmentInput = typeof BookAppointmentInput.Type;

export const BookAppointmentOutput = Schema.Struct({
  appointment: Appointment,
  session: CallSessionSnapshot,
}).annotate({ identifier: "BookAppointmentOutput" });
export type BookAppointmentOutput = typeof BookAppointmentOutput.Type;

export const CreateUploadLinkInput = Schema.Struct({
  sessionId: CallSessionId,
  email: Schema.String,
}).annotate({ identifier: "CreateUploadLinkInput" });
export type CreateUploadLinkInput = typeof CreateUploadLinkInput.Type;

export const CreateUploadLinkOutput = Schema.Struct({
  uploadSession: UploadSessionSnapshot,
  deliveryPreviewUrl: Schema.String,
  emailDelivery: EmailDelivery,
}).annotate({ identifier: "CreateUploadLinkOutput" });
export type CreateUploadLinkOutput = typeof CreateUploadLinkOutput.Type;

export class SessionNotFound extends Schema.TaggedErrorClass<SessionNotFound>()(
  "SessionNotFound",
  {
    sessionId: CallSessionId,
  },
) {}

export class CallRunNotFound extends Schema.TaggedErrorClass<CallRunNotFound>()(
  "CallRunNotFound",
  {
    runId: CallRunId,
  },
) {}

export class CallRunInProgress extends Schema.TaggedErrorClass<CallRunInProgress>()(
  "CallRunInProgress",
  {
    sessionId: CallSessionId,
  },
) {}

export class UploadSessionNotFound extends Schema.TaggedErrorClass<UploadSessionNotFound>()(
  "UploadSessionNotFound",
  {
    token: UploadToken,
  },
) {}

export class UploadSessionExpired extends Schema.TaggedErrorClass<UploadSessionExpired>()(
  "UploadSessionExpired",
  {
    token: UploadToken,
  },
) {}

export class NoMatchingTechnician extends Schema.TaggedErrorClass<NoMatchingTechnician>()(
  "NoMatchingTechnician",
  {
    applianceType: ApplianceType,
    zipCode: Schema.String,
  },
) {}

export class SlotAlreadyBooked extends Schema.TaggedErrorClass<SlotAlreadyBooked>()(
  "SlotAlreadyBooked",
  {
    slotId: SlotId,
  },
) {}
