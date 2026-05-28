import { UploadPage } from "@/routes/upload/-lib/upload-page.js";
import { serverHttpOrigin } from "@/services/rpc-client.js";
import type {
  Appointment,
  BookAppointmentInput,
  BookAppointmentOutput,
  CallRunEvent,
  CallRunId,
  CallRunWatchEvent,
  CallSessionId,
  CallSessionSnapshot,
  CreateUploadLinkInput,
  CreateUploadLinkOutput,
  DashboardSnapshot,
  EmailDelivery,
  StartCallRunInput,
  StartCallRunOutput,
  TechnicianLoad,
  UploadSessionSnapshot,
} from "@app/domain/service-contract";
import {
  AppointmentId,
  CallRunId as CallRunIdSchema,
  CallSessionId as CallSessionIdSchema,
  SlotId,
  TechnicianId,
  UploadToken,
} from "@app/domain/service-contract";
import { RegistryProvider } from "@effect/atom-react";
import { afterEach, expect, it } from "@effect/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as React from "react";
import { describe, vi } from "vitest";
import { CallConsolePanel } from "./call-console-panel.js";
import {
  activeCallRunStateAtom,
  activeSessionIdAtom,
  createCallPanelOpenAtom,
  DashboardApi,
  dashboardRuntime,
} from "./dashboard-atoms.js";
import { DashboardBanners } from "./dashboard-banners.js";
import { DashboardHeader } from "./dashboard-header.js";
import { DashboardPage } from "./dashboard-page.js";
import { SessionDetailPanel } from "./session-detail-panel.js";
import { SessionSummaryList } from "./session-summary-list.js";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: (props: {
      readonly children?: React.ReactNode;
      readonly className?: string;
      readonly to?: string;
    }) => <a className={props.className} href={props.to ?? "#"}>{props.children}</a>,
  };
});

const SESSION_ID = CallSessionIdSchema.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b01");
const OTHER_SESSION_ID = CallSessionIdSchema.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b02");
const RUN_ID = CallRunIdSchema.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b03");
const TOKEN = UploadToken.make("upload-token-1234567890");
const SLOT_ID = SlotId.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b04");
const TECHNICIAN_ID = TechnicianId.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b05");
const APPOINTMENT_ID = AppointmentId.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b06");

const makeSession = (
  overrides: Partial<CallSessionSnapshot> = {},
): CallSessionSnapshot => ({
  id: overrides.id ?? SESSION_ID,
  activeRunId: overrides.activeRunId ?? null,
  customerName: overrides.customerName ?? "Pat Jordan",
  phoneNumber: overrides.phoneNumber ?? "+1-555-0199",
  email: overrides.email ?? "pat@example.com",
  zipCode: overrides.zipCode ?? "60601",
  applianceType: overrides.applianceType ?? "refrigerator",
  status: overrides.status ?? "diagnosing",
  symptomSummary: overrides.symptomSummary ?? [],
  transcript: overrides.transcript ?? [],
  nextSteps: overrides.nextSteps ?? [],
  recommendedSlots: overrides.recommendedSlots ?? [],
  appointment: overrides.appointment ?? null,
  uploadSessions: overrides.uploadSessions ?? [],
  updatedAt: overrides.updatedAt ?? "2026-05-26T12:00:00.000Z",
});

const makeUploadSession = (
  overrides: Partial<UploadSessionSnapshot> = {},
): UploadSessionSnapshot => ({
  token: overrides.token ?? TOKEN,
  status: overrides.status ?? "pending",
  email: overrides.email ?? "pat@example.com",
  uploadUrl: overrides.uploadUrl ?? "http://localhost:4173/upload/upload-token-1234567890",
  uploadedAt: overrides.uploadedAt ?? null,
  analysisSummary: overrides.analysisSummary ?? null,
  recognizedApplianceType: overrides.recognizedApplianceType ?? null,
  visibleSignals: overrides.visibleSignals ?? [],
  expiresAt: overrides.expiresAt ?? "2026-05-28T12:00:00.000Z",
});

const makeAppointment = (
  overrides: Partial<Appointment> = {},
): Appointment => ({
  id: overrides.id ?? APPOINTMENT_ID,
  slotId: overrides.slotId ?? SLOT_ID,
  technicianId: overrides.technicianId ?? TECHNICIAN_ID,
  technicianName: overrides.technicianName ?? "Jordan Price",
  startsAt: overrides.startsAt ?? "2026-05-27T19:00:00.000Z",
  endsAt: overrides.endsAt ?? "2026-05-27T21:00:00.000Z",
  applianceType: overrides.applianceType ?? "refrigerator",
  zipCode: overrides.zipCode ?? "60601",
  confirmationCode: overrides.confirmationCode ?? "svc-abc123",
});

const makeTechnicianLoad = (
  overrides: Partial<TechnicianLoad> = {},
): TechnicianLoad => ({
  technicianId: overrides.technicianId ?? TECHNICIAN_ID,
  technicianName: overrides.technicianName ?? "Jordan Price",
  openSlots: overrides.openSlots ?? 2,
  specialties: overrides.specialties ?? ["refrigerator"],
  zipCodes: overrides.zipCodes ?? ["60601"],
});

const makeEmailDelivery = (
  overrides: Partial<EmailDelivery> = {},
): EmailDelivery => ({
  id: overrides.id ?? "email-1",
  to: overrides.to ?? "pat@example.com",
  subject: overrides.subject ?? "Upload your appliance photo",
  body: overrides.body ?? "Open the secure upload link.",
  relatedSessionId: overrides.relatedSessionId ?? SESSION_ID,
  createdAt: overrides.createdAt ?? "2026-05-27T12:00:00.000Z",
});

const makeDashboard = (
  sessions: ReadonlyArray<CallSessionSnapshot>,
): DashboardSnapshot => ({
  sessions: sessions.map((session) => ({
    id: session.id,
    activeRunId: session.activeRunId,
    customerName: session.customerName,
    applianceType: session.applianceType,
    status: session.status,
    latestAssistantMessage: session.transcript.at(-1)?.message ?? "",
    updatedAt: session.updatedAt,
  })),
  technicianLoad: [makeTechnicianLoad()],
  upcomingAppointments: [makeAppointment()],
  recentEmailDeliveries: [makeEmailDelivery()],
});

const makeApiLayer = (
  overrides?: Partial<{
    readonly getDashboardSnapshot: () => Effect.Effect<DashboardSnapshot>;
    readonly getCallSession: (sessionId: CallSessionId) => Effect.Effect<CallSessionSnapshot>;
    readonly getUploadSession: (token: typeof TOKEN) => Effect.Effect<UploadSessionSnapshot>;
    readonly bookAppointment: (
      payload: BookAppointmentInput,
    ) => Effect.Effect<BookAppointmentOutput>;
    readonly createUploadLink: (
      payload: CreateUploadLinkInput,
    ) => Effect.Effect<CreateUploadLinkOutput>;
    readonly startCallRun: (payload: StartCallRunInput) => Effect.Effect<StartCallRunOutput>;
    readonly callRunEvents: (runId: CallRunId) => Stream.Stream<CallRunEvent>;
    readonly callRunWatch: (sessionId: CallSessionId) => Stream.Stream<CallRunWatchEvent>;
    readonly interruptCallRun: (sessionId: CallSessionId) => Effect.Effect<void>;
  }>,
) =>
  Layer.succeed(
    DashboardApi,
    DashboardApi.of({
      getDashboardSnapshot: overrides?.getDashboardSnapshot
        ?? (() => Effect.succeed(makeDashboard([makeSession()]))),
      getCallSession: overrides?.getCallSession
        ?? ((sessionId) => Effect.succeed(makeSession({ id: sessionId }))),
      getUploadSession: overrides?.getUploadSession ?? (() => Effect.die("unused")),
      bookAppointment: overrides?.bookAppointment ?? (() => Effect.die("unused")),
      createUploadLink: overrides?.createUploadLink ?? (() => Effect.die("unused")),
      startCallRun: overrides?.startCallRun
        ?? ((payload) =>
          Effect.succeed({
            runId: RUN_ID,
            sessionId: payload.sessionId ?? SESSION_ID,
          })),
      callRunEvents: overrides?.callRunEvents ?? (() => Stream.never),
      callRunWatch: overrides?.callRunWatch ?? (() => Stream.never),
      interruptCallRun: overrides?.interruptCallRun ?? (() => Effect.void),
    }),
  );

const renderWithRegistry = (
  ui: React.ReactElement,
  options?: {
    readonly initialValues?: ReadonlyArray<readonly [Atom.Atom<any>, any]>;
    readonly apiLayer?: ReturnType<typeof makeApiLayer>;
  },
) =>
  render(
    <RegistryProvider
      initialValues={[
        Atom.initialValue(dashboardRuntime.layer, options?.apiLayer ?? makeApiLayer()),
        ...(options?.initialValues ?? []),
      ]}
    >
      {ui}
    </RegistryProvider>,
  );

describe.sequential("dashboard components", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the dashboard table and selects a session when its row is clicked", async () => {
    const first = makeSession({
      id: SESSION_ID,
      customerName: "Pat Jordan",
      transcript: [{ role: "assistant", message: "First session", at: "2026-05-26T12:00:00.000Z" }],
    });
    const second = makeSession({
      id: OTHER_SESSION_ID,
      customerName: "Sam Lee",
      transcript: [{
        role: "assistant",
        message: "Second session",
        at: "2026-05-26T12:00:00.000Z",
      }],
    });

    renderWithRegistry(<SessionSummaryList />, {
      apiLayer: makeApiLayer({
        getDashboardSnapshot: () => Effect.succeed(makeDashboard([first, second])),
      }),
    });

    const secondRowText = await screen.findByText("Sam Lee");
    await userEvent.click(secondRowText.closest("tr")!);

    await waitFor(() => {
      expect(secondRowText.closest("tr")?.className).toContain("bg-slate-100");
    });
    expect(screen.getByText("Second session")).toBeTruthy();
  });

  it("opens a new call workspace and submits the first turn manually", async () => {
    const startCallRun = vi.fn((payload: StartCallRunInput) =>
      Effect.succeed({
        runId: RUN_ID,
        sessionId: payload.sessionId ?? SESSION_ID,
      })
    );

    renderWithRegistry(<CallConsolePanel />, {
      apiLayer: makeApiLayer({ startCallRun }),
    });

    expect(await screen.findByRole("button", { name: "Start new call" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Start new call" }));
    expect(await screen.findByText("Start a new call")).toBeTruthy();
    expect(await screen.findByText(/Browser voice is unavailable/i)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Voice" }));
    expect(await screen.findByText(/Browser voice is unavailable/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start voice turn" })).toBeNull();

    const textarea: HTMLTextAreaElement = screen.getByRole("textbox", {
      name: /Opening issue/i,
    });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "The refrigerator is warm.");
    await userEvent.click(screen.getByRole("button", { name: "Start call" }));

    expect(startCallRun).toHaveBeenCalledWith({
      sessionId: null,
      customerName: "Pat Jordan",
      phoneNumber: "+1-555-0199",
      email: "pat@example.com",
      zipCode: "60601",
      utterance: "The refrigerator is warm.",
    });
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: /Opening issue/i })).toBeNull();
      const followUpTextarea = screen.getByRole("textbox", {
        name: /Next caller message/i,
      });

      if (!(followUpTextarea instanceof HTMLTextAreaElement)) {
        throw new Error("expected next caller message textarea");
      }

      expect(followUpTextarea.value).toBe("");
    });
  });

  it("shows the transcript immediately after sending a test call turn", async () => {
    renderWithRegistry(<DashboardPage />, {
      apiLayer: makeApiLayer({
        getCallSession: (sessionId) =>
          Effect.succeed(makeSession({
            id: sessionId,
            transcript: [],
          })),
        callRunEvents: () =>
          Stream.succeed<CallRunEvent>({
            _tag: "Chunk",
            delta: "Please tell me whether the freezer is still cold.",
          }),
        callRunWatch: () =>
          Stream.succeed<CallRunWatchEvent>({ _tag: "RunChanged", runId: RUN_ID }),
      }),
    });

    await userEvent.click((await screen.findAllByRole("button", { name: "New call" }))[0]!);

    const textarea = await screen.findByRole("textbox", { name: /Opening issue/i });

    await userEvent.clear(textarea);
    await userEvent.type(textarea, "The refrigerator is warm.");
    await userEvent.click(screen.getByRole("button", { name: "Start call" }));

    expect(await screen.findByText("Transcript")).toBeTruthy();
    expect(await screen.findByText("The refrigerator is warm.")).toBeTruthy();
    expect(await screen.findByText("Please tell me whether the freezer is still cold."))
      .toBeTruthy();
    expect(
      screen.queryByText("Choose a call from the list or start a new one."),
    )
      .toBeNull();
  });

  it("uses the selected call as the workspace for follow up turns", async () => {
    renderWithRegistry(<DashboardPage />, {
      apiLayer: makeApiLayer({
        getCallSession: (sessionId) =>
          Effect.succeed(makeSession({
            id: sessionId,
            transcript: [{
              role: "assistant",
              message: "Tell me what the refrigerator is doing now.",
              at: "2026-05-26T12:00:00.000Z",
            }],
          })),
      }),
      initialValues: [Atom.initialValue(activeSessionIdAtom, SESSION_ID)],
    });

    expect(await screen.findByText("Continue call")).toBeTruthy();
    expect(screen.getByText("Pat Jordan · +1-555-0199")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /Opening issue/i })).toBeNull();
    expect(screen.getByRole("textbox", { name: /Next caller message/i })).toBeTruthy();
  });

  it("shows the interrupt action only when a session has an active streaming run", async () => {
    renderWithRegistry(<DashboardHeader />, {
      apiLayer: makeApiLayer({
        getCallSession: (sessionId) =>
          Effect.succeed(makeSession({ id: sessionId, activeRunId: RUN_ID })),
      }),
      initialValues: [Atom.initialValue(activeSessionIdAtom, SESSION_ID)],
    });

    expect(await screen.findByRole("button", { name: "Stop reply" })).toBeTruthy();
  });

  it("opens the new call panel from the header", async () => {
    renderWithRegistry(<DashboardPage />, {
      apiLayer: makeApiLayer(),
      initialValues: [Atom.initialValue(activeSessionIdAtom, SESSION_ID)],
    });

    await userEvent.click((await screen.findAllByRole("button", { name: "New call" }))[0]!);

    expect(await screen.findByText("Start a new call")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /Opening issue/i })).toBeTruthy();
  });

  it("renders session details and triggers upload link plus booking actions", async () => {
    const createUploadLink = vi.fn(() =>
      Effect.succeed({
        uploadSession: makeUploadSession({ token: UploadToken.make("upload-token-abcdefghijk1") }),
        deliveryPreviewUrl: "http://localhost:4173/upload/upload-token-abcdefghijk1",
        emailDelivery: makeEmailDelivery(),
      })
    );
    const bookAppointment = vi.fn((payload: BookAppointmentInput) =>
      Effect.succeed({
        appointment: makeAppointment({ slotId: payload.slotId }),
        session: makeSession({ id: payload.sessionId, status: "scheduled" }),
      })
    );

    renderWithRegistry(<SessionDetailPanel />, {
      apiLayer: makeApiLayer({
        getCallSession: (sessionId) =>
          Effect.succeed(makeSession({
            id: sessionId,
            transcript: [{
              role: "assistant",
              message: "Please check the condenser coils.",
              at: "2026-05-26T12:00:00.000Z",
            }],
            nextSteps: [{
              key: "check-coils",
              instruction: "Please check the condenser coils.",
              completionHint: "Tell me if they are dusty.",
            }],
            recommendedSlots: [{
              id: SLOT_ID,
              technicianId: TECHNICIAN_ID,
              technicianName: "Jordan Price",
              startsAt: "2026-05-27T19:00:00.000Z",
              endsAt: "2026-05-27T21:00:00.000Z",
              applianceType: "refrigerator",
              zipCode: "60601",
            }],
            uploadSessions: [makeUploadSession({ analysisSummary: "Dust is visible." })],
          })),
        createUploadLink,
        bookAppointment,
      }),
      initialValues: [Atom.initialValue(activeSessionIdAtom, SESSION_ID)],
    });

    expect((await screen.findAllByText("Please check the condenser coils.")).length)
      .toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Send link" }));
    await userEvent.click(screen.getByRole("button", { name: "Book visit" }));

    expect(createUploadLink).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      email: "pat@example.com",
    });
    expect(bookAppointment).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      slotId: SLOT_ID,
      customerName: "Pat Jordan",
      phoneNumber: "+1-555-0199",
      zipCode: "60601",
      applianceType: "refrigerator",
    });
    expect(screen.getByText("Open")).toBeTruthy();
  });

  it("renders the upload-link success banner after preparing an upload link", async () => {
    const createUploadLink = vi.fn(() =>
      Effect.succeed({
        uploadSession: makeUploadSession({ token: UploadToken.make("upload-token-abcdefghijk1") }),
        deliveryPreviewUrl: "http://localhost:4173/upload/upload-token-abcdefghijk1",
        emailDelivery: makeEmailDelivery(),
      })
    );

    renderWithRegistry(
      <>
        <DashboardBanners />
        <SessionDetailPanel />
      </>,
      {
        apiLayer: makeApiLayer({
          getCallSession: (sessionId) => Effect.succeed(makeSession({ id: sessionId })),
          createUploadLink,
        }),
        initialValues: [Atom.initialValue(activeSessionIdAtom, SESSION_ID)],
      },
    );

    await userEvent.click(await screen.findByRole("button", { name: "Send link" }));

    expect(await screen.findByText(/Upload link ready for pat@example.com/i)).toBeTruthy();
    expect(screen.getByText("/upload/upload-token-abcdefghijk1")).toBeTruthy();
  });

  it("shows only recent emails related to the active session", async () => {
    renderWithRegistry(<SessionDetailPanel />, {
      apiLayer: makeApiLayer({
        getDashboardSnapshot: () =>
          Effect.succeed({
            ...makeDashboard([
              makeSession({ id: SESSION_ID }),
              makeSession({ id: OTHER_SESSION_ID }),
            ]),
            recentEmailDeliveries: [
              makeEmailDelivery({
                id: "email-session",
                to: "pat@example.com",
                subject: "Upload your appliance photo",
                body: "Session email body",
                relatedSessionId: SESSION_ID,
              }),
              makeEmailDelivery({
                id: "email-other",
                to: "sam@example.com",
                subject: "Other session",
                body: "Other session email body",
                relatedSessionId: OTHER_SESSION_ID,
              }),
            ],
          }),
        getCallSession: (sessionId) => Effect.succeed(makeSession({ id: sessionId })),
      }),
      initialValues: [Atom.initialValue(activeSessionIdAtom, SESSION_ID)],
    });

    expect(await screen.findByText("Session email body")).toBeTruthy();
    expect(screen.queryByText("Other session email body")).toBeNull();
  });

  it("hides the new call panel when a session row is selected", async () => {
    renderWithRegistry(<DashboardPage />, {
      apiLayer: makeApiLayer({
        getDashboardSnapshot: () =>
          Effect.succeed(makeDashboard([
            makeSession({ id: SESSION_ID, customerName: "Pat Jordan" }),
            makeSession({ id: OTHER_SESSION_ID, customerName: "Sam Lee" }),
          ])),
      }),
      initialValues: [Atom.initialValue(createCallPanelOpenAtom, true)],
    });

    expect(await screen.findByText("Start a new call")).toBeTruthy();

    const samLee = await screen.findByText("Sam Lee");
    await userEvent.click(samLee.closest("tr")!);

    expect(await screen.findByText("Continue call")).toBeTruthy();
    expect(screen.queryByText("Start a new call")).toBeNull();
  });

  it("keeps the transcript at the top and gives the operations rail its own scroll pane", async () => {
    renderWithRegistry(<SessionDetailPanel />, {
      apiLayer: makeApiLayer({
        getCallSession: (sessionId) =>
          Effect.succeed(makeSession({
            id: sessionId,
            transcript: [{
              role: "assistant",
              message: "Please tell me whether the freezer is still cold.",
              at: "2026-05-26T12:00:05.000Z",
            }],
            recommendedSlots: [{
              id: SLOT_ID,
              technicianId: TECHNICIAN_ID,
              technicianName: "Jordan Price",
              startsAt: "2026-05-27T19:00:00.000Z",
              endsAt: "2026-05-27T21:00:00.000Z",
              applianceType: "refrigerator",
              zipCode: "60601",
            }],
            uploadSessions: [makeUploadSession()],
          })),
      }),
      initialValues: [Atom.initialValue(activeSessionIdAtom, SESSION_ID)],
    });

    const transcriptHeading = await screen.findByText("Transcript");
    const callerHeading = screen.getByText("Pat Jordan");

    expect(
      transcriptHeading.compareDocumentPosition(callerHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Visit").closest("section")?.parentElement?.className)
      .not.toContain("overflow-auto");
  });

  it("does not show the empty visit placeholder when an appointment already exists", async () => {
    renderWithRegistry(<SessionDetailPanel />, {
      apiLayer: makeApiLayer({
        getCallSession: (sessionId) =>
          Effect.succeed(makeSession({
            id: sessionId,
            status: "scheduled",
            recommendedSlots: [],
            appointment: makeAppointment({
              startsAt: "2026-05-28T04:00:00.000Z",
              endsAt: "2026-05-28T06:00:00.000Z",
            }),
          })),
      }),
      initialValues: [Atom.initialValue(activeSessionIdAtom, SESSION_ID)],
    });

    expect(await screen.findByText("Jordan Price")).toBeTruthy();
    expect(screen.queryByText("No visit slot yet.")).toBeNull();
    expect(screen.getByText("svc-abc123")).toBeTruthy();
    expect(screen.getByText(/5\/27\/2026.*to.*5\/28\/2026/i)).toBeTruthy();
  });

  it("keeps malformed streaming assistant payloads hidden behind the progress banner", () => {
    renderWithRegistry(<DashboardBanners />, {
      initialValues: [Atom.initialValue(activeCallRunStateAtom, {
        _tag: "Streaming",
        runId: RUN_ID,
        assistantMessage: "{\"name\":\"get_appliance_type\",\"arguments\":{\"zipCode\":\"60601\"}}",
        events: [],
      })],
    });

    expect(screen.getByText("Agent is replying.")).toBeTruthy();
    expect(screen.queryByText(/get_appliance_type/i)).toBeNull();
  });

  it("renders the session-detail empty state when no session is active", () => {
    renderWithRegistry(<SessionDetailPanel />);

    expect(screen.getByText("Choose a call from the list or start a new one.")).toBeTruthy();
  });

  it("renders the dashboard page shell with the review layout", async () => {
    renderWithRegistry(<DashboardPage />);

    expect(await screen.findByText("Call review")).toBeTruthy();
    expect(screen.getByText("Recent calls")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Caller" })).toBeTruthy();
    expect(screen.getByText("Choose a call or start a new one")).toBeTruthy();
    expect(
      screen.getByText("Choose a call or start a new one").closest("section")?.parentElement
        ?.className,
    )
      .toContain("overflow-y-auto");
  });

  it("renders the upload page success state and shows backend upload failures", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        text: () => Promise.resolve("Upload failed."),
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    renderWithRegistry(<UploadPage token={TOKEN} />, {
      apiLayer: makeApiLayer({
        getUploadSession: () =>
          Effect.succeed(makeUploadSession({
            status: "analyzed",
            analysisSummary: "Dust is visible near the condenser area.",
            recognizedApplianceType: "refrigerator",
          })),
      }),
    });

    expect(await screen.findByText("Add a photo of your appliance")).toBeTruthy();
    expect(await screen.findByText("Dust is visible near the condenser area.")).toBeTruthy();

    const fileInput = document.querySelector("input[type='file']");
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("expected file input");
    }

    await userEvent.upload(
      fileInput,
      new File(["image-bytes"], "fridge.jpg", { type: "image/jpeg" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload photo" }));

    expect(await screen.findByText("Upload failed.")).toBeTruthy();
  });

  it("blocks upload submission until a real file is selected", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    renderWithRegistry(<UploadPage token={TOKEN} />, {
      apiLayer: makeApiLayer({
        getUploadSession: () =>
          Effect.succeed(makeUploadSession({
            status: "pending",
          })),
      }),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Upload photo" }));

    expect(await screen.findByText("Choose an image file before submitting.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits an upload image to the backend and refreshes the upload session", async () => {
    const getUploadSession = vi.fn(() =>
      Effect.succeed(makeUploadSession({
        status: "pending",
        recognizedApplianceType: "refrigerator",
      }))
    );
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    renderWithRegistry(<UploadPage token={TOKEN} />, {
      apiLayer: makeApiLayer({ getUploadSession }),
    });

    const fileInput = document.querySelector("input[type='file']");
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("expected file input");
    }

    await userEvent.upload(
      fileInput,
      new File(["image-bytes"], "fridge.jpg", { type: "image/jpeg" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload photo" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`${serverHttpOrigin}/api/uploads/${TOKEN}`, {
        body: expect.any(FormData),
        method: "POST",
      });
    });
    await waitFor(() => {
      expect(getUploadSession).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText("Cannot read properties of null (reading 'reset')")).toBeNull();
    });
  });
});
