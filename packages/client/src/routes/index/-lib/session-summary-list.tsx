import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  activeSessionIdAtom,
  createCallPanelOpenAtom,
  dashboardSnapshotAtom,
} from "./dashboard-atoms.js";
import { applianceLabel, renderAsyncResult } from "./dashboard-shared.js";

export const SessionSummaryList = () => {
  const dashboard = useAtomValue(dashboardSnapshotAtom);
  const selectedSessionId = useAtomValue(activeSessionIdAtom);
  const setActiveSessionId = useAtomSet(activeSessionIdAtom);
  const setCreateCallPanelOpen = useAtomSet(createCallPanelOpenAtom);

  return renderAsyncResult(
    dashboard,
    (value) => (
      <div className="min-h-0 overflow-auto">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.08em] text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Caller</th>
              <th className="px-3 py-2 font-semibold">Appliance</th>
            </tr>
          </thead>
          <tbody>
            {value.sessions.map((session) => (
              <tr
                className={`cursor-pointer border-b border-slate-100 ${
                  selectedSessionId === session.id ? "bg-slate-100" : "bg-white"
                }`}
                key={session.id}
                onClick={() => {
                  setCreateCallPanelOpen(false);
                  setActiveSessionId(session.id);
                }}
              >
                <td className="px-3 py-3 align-top">
                  <div className="font-medium text-slate-900">{session.customerName}</div>
                  <div className="truncate text-xs text-slate-500">
                    {session.latestAssistantMessage}
                  </div>
                </td>
                <td className="px-3 py-3 align-top text-slate-700">
                  {applianceLabel(session.applianceType)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  );
};
