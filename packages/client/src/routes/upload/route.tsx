import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/upload")({
  component: () => <Outlet />,
});
