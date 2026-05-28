import { CallConsolePanel } from "./call-console-panel.js";
import { DashboardBanners } from "./dashboard-banners.js";
import { DashboardHeader } from "./dashboard-header.js";
import { SessionDetailPanel } from "./session-detail-panel.js";
import { SessionSummaryList } from "./session-summary-list.js";

export const DashboardPage = () => (
  <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
    <DashboardHeader />
    <DashboardBanners />
    <div className="grid min-h-0 flex-1 grid-cols-[20rem_1fr] gap-4 overflow-hidden p-4">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Recent calls</h2>
        </div>
        <SessionSummaryList />
      </section>
      <section className="flex min-h-0 flex-col gap-4 overflow-y-auto overflow-x-hidden pr-1">
        <CallConsolePanel />
        <SessionDetailPanel />
      </section>
    </div>
  </div>
);
