import { uploadSessionAtom } from "@/routes/index/-lib/dashboard-atoms.js";
import { serverHttpOrigin } from "@/services/rpc-client.js";
import type { UploadToken } from "@app/domain/service-contract";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as DateTime from "effect/DateTime";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as React from "react";

const formatDateTime = (value: string) =>
  DateTime.toDateUtc(DateTime.makeUnsafe(value)).toLocaleString();

export const UploadPage = (props: {
  readonly token: UploadToken;
}) => {
  const uploadSessionResult = useAtomValue(uploadSessionAtom(props.token));
  const refreshUploadSession = useAtomRefresh(uploadSessionAtom(props.token));
  const [banner, setBanner] = React.useState<string | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);

  const submitUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBanner(null);
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file");
    if (!(fileInput instanceof HTMLInputElement) || fileInput.files?.item(0) === null) {
      setBanner("Choose an image file before submitting.");
      return;
    }
    const formData = new FormData(form);
    setIsUploading(true);
    try {
      const response = await fetch(`${serverHttpOrigin}/api/uploads/${props.token}`, {
        body: formData,
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body);
      }
      refreshUploadSession();
      form.reset();
    } catch (error) {
      setBanner(error instanceof Error ? error.message : String(error));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
      {banner === null
        ? null
        : (
          <div className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-900">
            {banner}
          </div>
        )}
      <div className="mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        <div className="rounded-md border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-semibold text-slate-950">Add a photo of your appliance</h1>
          <p className="mt-1 text-sm text-slate-600">
            Use the photo to help the diagnostic agent see the appliance and any visible issues.
          </p>
        </div>

        {AsyncResult.matchWithWaiting(uploadSessionResult, {
          onWaiting: () => (
            <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-500">
              Opening your upload link.
            </div>
          ),
          onError: (error) => (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
              {JSON.stringify(error)}
            </div>
          ),
          onDefect: (defect) => (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
              {String(defect)}
            </div>
          ),
          onSuccess: (success) => (
            <>
              <div className="rounded-md border border-slate-200 bg-white p-5">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-slate-500">Email</dt>
                    <dd className="text-slate-900">{success.value.email}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Status</dt>
                    <dd className="text-slate-900">{success.value.status}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Expires</dt>
                    <dd className="text-slate-900">
                      {formatDateTime(success.value.expiresAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Detected appliance</dt>
                    <dd className="text-slate-900">
                      {success.value.recognizedApplianceType ?? "-"}
                    </dd>
                  </div>
                </dl>
              </div>

              <form
                className="rounded-md border border-slate-200 bg-white p-5"
                onSubmit={(event) => {
                  void submitUpload(event);
                }}
              >
                <label className="block text-sm text-slate-700">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
                    Photo
                  </span>
                  <input className="block w-full text-sm text-slate-700" name="file" type="file" />
                </label>
                <button
                  className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                  disabled={isUploading}
                  type="submit"
                >
                  {isUploading ? "Uploading" : "Upload photo"}
                </button>
              </form>

              {success.value.analysisSummary === null
                ? null
                : (
                  <div className="rounded-md border border-slate-200 bg-white p-5">
                    <h2 className="text-sm font-semibold text-slate-900">What we found</h2>
                    <p className="mt-2 text-sm text-slate-700">{success.value.analysisSummary}</p>
                  </div>
                )}
            </>
          ),
        })}
      </div>
    </div>
  );
};
