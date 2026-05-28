import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type * as React from "react";
import {
  activeCallRunStateAtom,
  bookAppointmentMutationAtom,
  createUploadLinkMutationAtom,
  interruptCallRunAtom,
  startCallRunAtom,
} from "./dashboard-atoms.js";
import { renderCause } from "./dashboard-shared.js";

const streamingBannerMessage = (assistantMessage: string) => {
  const trimmedAssistantMessage = assistantMessage.trim();

  if (
    trimmedAssistantMessage.length === 0
    || trimmedAssistantMessage.startsWith("{")
    || trimmedAssistantMessage.startsWith("[")
    || trimmedAssistantMessage.startsWith("\"")
  ) {
    return "Agent is replying.";
  }

  return trimmedAssistantMessage;
};

const DashboardBanner = (props: {
  readonly tone: "warning" | "info" | "success";
  readonly children: React.ReactNode;
}) => {
  const toneClassName = {
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    info: "border-blue-300 bg-blue-50 text-blue-950",
    success: "border-violet-300 bg-violet-50 text-violet-900",
  }[props.tone];

  return <div className={`border-b px-6 py-3 text-sm ${toneClassName}`}>{props.children}</div>;
};

export const DashboardBanners = () => {
  const liveCallRun = useAtomValue(activeCallRunStateAtom);
  const startCallRunResult = useAtomValue(startCallRunAtom);
  const uploadLinkResult = useAtomValue(createUploadLinkMutationAtom);
  const bookAppointmentResult = useAtomValue(bookAppointmentMutationAtom);
  const interruptCallRunResult = useAtomValue(interruptCallRunAtom);

  return (
    <>
      {AsyncResult.isFailure(startCallRunResult)
        ? <DashboardBanner tone="warning">{renderCause(startCallRunResult.cause)}</DashboardBanner>
        : null}
      {liveCallRun._tag === "Failed"
        ? <DashboardBanner tone="warning">{renderCause(liveCallRun.cause)}</DashboardBanner>
        : null}
      {AsyncResult.isFailure(bookAppointmentResult)
        ? (
          <DashboardBanner tone="warning">
            {renderCause(bookAppointmentResult.cause)}
          </DashboardBanner>
        )
        : null}
      {AsyncResult.isFailure(uploadLinkResult)
        ? <DashboardBanner tone="warning">{renderCause(uploadLinkResult.cause)}</DashboardBanner>
        : null}
      {AsyncResult.isFailure(interruptCallRunResult)
        ? (
          <DashboardBanner tone="warning">
            {renderCause(interruptCallRunResult.cause)}
          </DashboardBanner>
        )
        : null}
      {AsyncResult.isSuccess(uploadLinkResult)
        ? (
          <DashboardBanner tone="success">
            Upload link ready for {uploadLinkResult.value.uploadSession.email}. Open{" "}
            <Link
              className="font-medium underline underline-offset-2"
              params={{ token: uploadLinkResult.value.uploadSession.token }}
              to="/upload/$token"
            >
              /upload/{uploadLinkResult.value.uploadSession.token}
            </Link>
            .
          </DashboardBanner>
        )
        : null}
      {liveCallRun._tag === "Streaming"
        ? (
          <DashboardBanner tone="info">
            {streamingBannerMessage(liveCallRun.assistantMessage)}
          </DashboardBanner>
        )
        : null}
    </>
  );
};
