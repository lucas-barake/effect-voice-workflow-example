import { UploadToken } from "@app/domain/service-contract";
import { createFileRoute } from "@tanstack/react-router";
import { UploadPage } from "./-lib/upload-page.js";

export const Route = createFileRoute("/upload/$token")({
  component: () => <UploadPage token={UploadToken.make(Route.useParams().token)} />,
});
