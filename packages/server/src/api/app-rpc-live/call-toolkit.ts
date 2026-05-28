import {
  ApplianceType,
  AvailableSlot,
  CallRunEvent,
  CallSessionId,
  TechnicianLoad,
  UploadSessionSnapshot,
} from "@app/domain/service-contract";
import * as Context from "effect/Context";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import type * as Take from "effect/Take";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

export class CallMailbox extends Context.Service<
  CallMailbox,
  PubSub.PubSub<Take.Take<CallRunEvent>>
>()("CallMailbox") {}

export class CallToolContext extends Context.Service<CallToolContext, {
  readonly sessionId: typeof CallSessionId.Type;
}>()("CallToolContext") {}

export const LookupRecommendedSlots = Tool.make("lookup_recommended_slots", {
  description: "Look up the best currently open repair slots for an appliance and zip code.",
  parameters: Schema.Struct({
    zipCode: Schema.String,
    applianceType: ApplianceType,
  }),
  success: Schema.Array(AvailableSlot),
  dependencies: [CallMailbox],
});

export const LookupTechnicianLoad = Tool.make("lookup_technician_load", {
  description: "Look up technician coverage and open capacity for dispatch planning.",
  parameters: Schema.Struct({}),
  success: Schema.Array(TechnicianLoad),
  dependencies: [CallMailbox],
});

export const LookupUploadContext = Tool.make("lookup_upload_context", {
  description: "Look up the current upload invitations and analysis results for this call.",
  parameters: Schema.Struct({}),
  success: Schema.Array(UploadSessionSnapshot),
  dependencies: [CallMailbox, CallToolContext],
});

export const CallToolkit = Toolkit.make(
  LookupRecommendedSlots,
  LookupTechnicianLoad,
  LookupUploadContext,
);
