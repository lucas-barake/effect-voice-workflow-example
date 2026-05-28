import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  activeCallRunStateAtom,
  activeSessionIdAtom,
  createCallPanelOpenAtom,
  interruptCallRunAtom,
} from "./dashboard-atoms.js";

export const DashboardHeader = () => {
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const liveCallRun = useAtomValue(activeCallRunStateAtom);
  const interruptCallRun = useAtomSet(interruptCallRunAtom);
  const setActiveSessionId = useAtomSet(activeSessionIdAtom);
  const setCreateCallPanelOpen = useAtomSet(createCallPanelOpenAtom);

  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Call review</h1>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          onClick={() => {
            setActiveSessionId(null);
            setCreateCallPanelOpen(true);
          }}
          type="button"
        >
          New call
        </button>
        {activeSessionId === null || liveCallRun._tag !== "Streaming"
          ? null
          : (
            <button
              className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:text-slate-900"
              onClick={() => {
                interruptCallRun({ sessionId: activeSessionId });
              }}
              type="button"
            >
              Stop reply
            </button>
          )}
      </div>
    </div>
  );
};
