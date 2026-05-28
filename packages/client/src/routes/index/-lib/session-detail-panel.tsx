import type { CallSessionId } from "@app/domain/service-contract";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  activeSessionIdAtom,
  bookAppointmentMutationAtom,
  callRunStateFamily,
  createCallPanelOpenAtom,
  createUploadLinkMutationAtom,
  dashboardSnapshotAtom,
  selectedSessionAtom,
  sessionTranscriptAtom,
  simulatorFormAtom,
} from "./dashboard-atoms.js";
import {
  applianceLabel,
  formatDateTime,
  formatDateTimeRange,
  renderAsyncResult,
  statusTone,
} from "./dashboard-shared.js";

const EmailOutbox = (props: {
  readonly sessionId: CallSessionId;
}) => {
  const dashboardResult = useAtomValue(dashboardSnapshotAtom);

  return renderAsyncResult(
    dashboardResult,
    (dashboard) => {
      const relatedDeliveries = dashboard.recentEmailDeliveries.filter((delivery) =>
        delivery.relatedSessionId === props.sessionId
      );

      return (
        <div className="space-y-2">
          {relatedDeliveries.length === 0
            ? <div className="text-sm text-slate-500">No email yet.</div>
            : relatedDeliveries.map((delivery) => (
              <div className="rounded border border-slate-200 p-3" key={delivery.id}>
                <div className="text-sm font-medium text-slate-900">{delivery.to}</div>
                <div className="mt-1 text-xs text-slate-500">{delivery.subject}</div>
                <div className="mt-2 text-xs text-slate-600">{delivery.body}</div>
              </div>
            ))}
        </div>
      );
    },
  );
};

const SelectedSessionDetail = (props: {
  readonly sessionId: CallSessionId;
}) => {
  const bookAppointment = useAtomSet(bookAppointmentMutationAtom);
  const createUploadLink = useAtomSet(createUploadLinkMutationAtom);
  const form = useAtomValue(simulatorFormAtom);
  const sessionResult = useAtomValue(selectedSessionAtom(props.sessionId));

  return renderAsyncResult(
    sessionResult,
    (session) => (
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(20rem,24rem)] items-start gap-4">
        <section className="flex flex-col gap-4">
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{session.customerName}</h2>
                <p className="text-sm text-slate-600">{session.phoneNumber}</p>
              </div>
              <span
                className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                  statusTone[String(session.status)] ?? "bg-slate-100 text-slate-700"
                }`}
              >
                {session.status}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Appliance</dt>
                <dd className="text-slate-900">{applianceLabel(session.applianceType)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Zip code</dt>
                <dd className="text-slate-900">{session.zipCode ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Email</dt>
                <dd className="text-slate-900">{session.email ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Updated</dt>
                <dd className="text-slate-900">{formatDateTime(session.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Next actions</h3>
            <div className="space-y-3">
              {session.nextSteps.length === 0
                ? <p className="text-sm text-slate-500">No troubleshooting step yet.</p>
                : session.nextSteps.map((step) => (
                  <div className="rounded-md border border-slate-200 p-3" key={step.key}>
                    <div className="text-sm font-medium text-slate-900">{step.instruction}</div>
                    <div className="mt-1 text-xs text-slate-500">{step.completionHint}</div>
                  </div>
                ))}
            </div>
          </section>
        </section>

        <section className="flex flex-col gap-4">
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Visit</h3>
            <div className="space-y-3">
              {session.recommendedSlots.length === 0 && session.appointment === null
                ? <p className="text-sm text-slate-500">No visit slot yet.</p>
                : session.recommendedSlots.map((slot) => (
                  <div className="rounded-md border border-slate-200 p-3" key={slot.id}>
                    <div className="text-sm font-medium text-slate-900">{slot.technicianName}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDateTimeRange(slot.startsAt, slot.endsAt)}
                    </div>
                    <button
                      className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
                      onClick={() => {
                        bookAppointment({
                          sessionId: session.id,
                          slotId: slot.id,
                          customerName: session.customerName,
                          phoneNumber: session.phoneNumber,
                          zipCode: session.zipCode ?? form.zipCode,
                          applianceType: session.applianceType ?? "refrigerator",
                        });
                      }}
                      type="button"
                    >
                      Book visit
                    </button>
                  </div>
                ))}
              {session.appointment === null
                ? null
                : (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="text-sm font-medium text-slate-900">
                      {session.appointment.technicianName}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {formatDateTimeRange(
                        session.appointment.startsAt,
                        session.appointment.endsAt,
                      )}
                    </div>
                    <div className="mt-2 font-mono text-xs text-slate-500">
                      {session.appointment.confirmationCode}
                    </div>
                  </div>
                )}
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">Photo</h3>
              <button
                className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:text-slate-900"
                onClick={() => {
                  createUploadLink({
                    sessionId: session.id,
                    email: session.email ?? form.email,
                  });
                }}
                type="button"
              >
                Send link
              </button>
            </div>
            <div className="space-y-3">
              {session.uploadSessions.length === 0
                ? <p className="text-sm text-slate-500">No photo request yet.</p>
                : session.uploadSessions.map((uploadSession) => (
                  <div
                    className="rounded-md border border-slate-200 p-3"
                    key={String(uploadSession.token)}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          {uploadSession.email}
                        </div>
                        <div className="font-mono text-xs text-slate-500">
                          {uploadSession.token}
                        </div>
                      </div>
                      <Link
                        className="text-sm font-medium text-slate-900 underline underline-offset-2"
                        params={{ token: uploadSession.token }}
                        to="/upload/$token"
                      >
                        Open
                      </Link>
                    </div>
                    {uploadSession.analysisSummary === null
                      ? null
                      : (
                        <p className="mt-2 text-sm text-slate-700">
                          {uploadSession.analysisSummary}
                        </p>
                      )}
                  </div>
                ))}
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Recent emails</h3>
            <EmailOutbox sessionId={session.id} />
          </section>
        </section>
      </div>
    ),
  );
};

const SessionTranscriptPanel = (props: {
  readonly sessionId: CallSessionId;
}) => {
  const transcript = useAtomValue(sessionTranscriptAtom(props.sessionId));
  const liveCallRun = useAtomValue(callRunStateFamily(props.sessionId));

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">Transcript</h3>
      <div className="space-y-3">
        {transcript.length === 0 && liveCallRun._tag === "Idle"
          ? <p className="text-sm text-slate-500">No conversation yet.</p>
          : transcript.map((entry, index) => (
            <div
              className="rounded-md border border-slate-200 bg-slate-50 p-3"
              key={`${entry.role}-${index}`}
            >
              <div className="mb-1 text-xs uppercase tracking-[0.08em] text-slate-500">
                {entry.role}
              </div>
              <div className="text-sm text-slate-800">{entry.message}</div>
            </div>
          ))}
      </div>
    </section>
  );
};

export const SessionDetailPanel = () => {
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const createCallPanelOpen = useAtomValue(createCallPanelOpenAtom);

  return (
    <section className="flex flex-col gap-4">
      {activeSessionId === null
        ? (
          <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">
            {createCallPanelOpen
              ? "Start the call to open the transcript, visit plan, and photo flow."
              : "Choose a call from the list or start a new one."}
          </div>
        )
        : (
          <>
            <SessionTranscriptPanel sessionId={activeSessionId} />
            <SelectedSessionDetail sessionId={activeSessionId} />
          </>
        )}
    </section>
  );
};
