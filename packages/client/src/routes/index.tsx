import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "./index/-lib/dashboard-page.js";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});
