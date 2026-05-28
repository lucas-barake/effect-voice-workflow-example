import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import {
  BookAppointmentInput,
  BookAppointmentOutput,
  CallRunEvent,
  CallRunId,
  CallRunInProgress,
  CallRunNotFound,
  CallRunWatchEvent,
  CallSessionId,
  CallSessionSnapshot,
  CreateUploadLinkInput,
  CreateUploadLinkOutput,
  DashboardSnapshot,
  NoMatchingTechnician,
  SessionNotFound,
  SlotAlreadyBooked,
  StartCallRunInput,
  StartCallRunOutput,
  UploadSessionExpired,
  UploadSessionNotFound,
  UploadSessionSnapshot,
  UploadToken,
} from "../service-contract.js";

export const AppRpc = RpcGroup.make(
  Rpc.make("GetDashboardSnapshot", {
    success: DashboardSnapshot,
  }),
  Rpc.make("GetCallSession", {
    payload: {
      sessionId: CallSessionId,
    },
    success: CallSessionSnapshot,
    error: SessionNotFound,
  }),
  Rpc.make("StartCallRun", {
    payload: StartCallRunInput,
    success: StartCallRunOutput,
    error: Schema.Union([SessionNotFound, CallRunInProgress]),
  }),
  Rpc.make("CallRunEvents", {
    stream: true,
    payload: { runId: CallRunId },
    success: CallRunEvent,
    error: CallRunNotFound,
  }),
  Rpc.make("CallRunWatch", {
    stream: true,
    payload: { sessionId: CallSessionId },
    success: CallRunWatchEvent,
    error: SessionNotFound,
  }),
  Rpc.make("InterruptCallRun", {
    payload: { sessionId: CallSessionId },
    success: Schema.Void,
    error: SessionNotFound,
  }),
  Rpc.make("BookAppointment", {
    payload: BookAppointmentInput,
    success: BookAppointmentOutput,
    error: Schema.Union([SessionNotFound, NoMatchingTechnician, SlotAlreadyBooked]),
  }),
  Rpc.make("CreateUploadLink", {
    payload: CreateUploadLinkInput,
    success: CreateUploadLinkOutput,
    error: SessionNotFound,
  }),
  Rpc.make("GetUploadSession", {
    payload: {
      token: UploadToken,
    },
    success: UploadSessionSnapshot,
    error: Schema.Union([UploadSessionNotFound, UploadSessionExpired]),
  }),
);
