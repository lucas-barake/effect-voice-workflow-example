import {
  ApplianceType,
  AvailableSlot,
  CallRunId,
  CallSessionId,
  SessionStatus,
  TechnicianLoad,
  TranscriptEntry,
  TroubleSignal,
  UploadSessionSnapshot,
} from "@app/domain/service-contract";
import * as Schema from "effect/Schema";
import { Model } from "effect/unstable/schema";

export const GuidanceStepSchema = Schema.Struct({
  key: Schema.String,
  instruction: Schema.String,
  completionHint: Schema.String,
});

export const TranscriptSchema = Schema.Array(TranscriptEntry);
export const TroubleSignalSchema = Schema.Array(TroubleSignal);
export const GuidanceStepsSchema = Schema.Array(GuidanceStepSchema);

export class CallSessionModel extends Model.Class<CallSessionModel>("CallSessionModel")({
  id: Model.Generated(CallSessionId),
  customerName: Schema.String,
  phoneNumber: Schema.String,
  email: Schema.NullOr(Schema.String),
  zipCode: Schema.NullOr(Schema.String),
  applianceType: Schema.NullOr(ApplianceType),
  status: SessionStatus,
  transcript: Model.JsonFromString(TranscriptSchema),
  symptomSummary: Model.JsonFromString(TroubleSignalSchema),
  nextSteps: Model.JsonFromString(GuidanceStepsSchema),
  latestAssistantMessage: Schema.String,
  appointmentId: Schema.NullOr(Schema.String),
  activeRunId: Schema.NullOr(CallRunId),
  createdAt: Model.DateTimeInsert,
  updatedAt: Model.DateTimeUpdate,
}) {}

export const RecommendedSlotRow = AvailableSlot;

export const TechnicianLoadRow = TechnicianLoad;

export const UploadSessionRow = UploadSessionSnapshot;
