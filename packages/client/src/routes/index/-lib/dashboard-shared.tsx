import type { ApplianceType } from "@app/domain/service-contract";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type * as React from "react";

export const renderAsyncResult = <A,>(
  result: AsyncResult.AsyncResult<A, unknown>,
  render: (value: A) => React.ReactNode,
) =>
  AsyncResult.matchWithWaiting(result, {
    onWaiting: () => (
      <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Connecting to the server.
      </div>
    ),
    onError: (error) => (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        {JSON.stringify(error)}
      </div>
    ),
    onDefect: (defect) => (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        {String(defect)}
      </div>
    ),
    onSuccess: (success) => render(success.value),
  });

export const statusTone: Readonly<Record<string, string>> = {
  intake: "bg-slate-100 text-slate-700",
  diagnosing: "bg-blue-100 text-blue-800",
  troubleshooting: "bg-indigo-100 text-indigo-800",
  resolved: "bg-emerald-100 text-emerald-800",
  ready_to_schedule: "bg-amber-100 text-amber-800",
  scheduled: "bg-emerald-100 text-emerald-800",
  awaiting_upload: "bg-violet-100 text-violet-800",
};

export const applianceLabel = (value: ApplianceType | null) => value ?? "-";
export const formatDateTime = (value: string) =>
  DateTime.toDateUtc(DateTime.makeUnsafe(value)).toLocaleString();
export const formatTime = (value: string) =>
  DateTime.toDateUtc(DateTime.makeUnsafe(value)).toLocaleTimeString();
export const formatDateTimeRange = (startsAt: string, endsAt: string) => {
  const start = DateTime.toDateUtc(DateTime.makeUnsafe(startsAt));
  const end = DateTime.toDateUtc(DateTime.makeUnsafe(endsAt));

  return start.toLocaleDateString() === end.toLocaleDateString()
    ? `${start.toLocaleString()} to ${end.toLocaleTimeString()}`
    : `${start.toLocaleString()} to ${end.toLocaleString()}`;
};
export const renderCause = (cause: Cause.Cause<unknown>) => Cause.pretty(cause);
