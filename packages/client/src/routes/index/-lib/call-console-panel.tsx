import type { CallSessionId } from "@app/domain/service-contract";
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as React from "react";
import {
  activeCallRunStateAtom,
  activeSessionIdAtom,
  activeSessionResultAtom,
  autoSpeakAssistantAtom,
  createCallPanelOpenAtom,
  simulatorFormAtom,
  startCallRunAtom,
  voiceModeAtom,
  watchCallSessionFamily,
} from "./dashboard-atoms.js";

declare global {
  interface Window {
    SpeechRecognition?: new() => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      start: () => void;
      stop: () => void;
      onend: (() => void) | null;
      onerror:
        | ((event: {
          readonly error: string;
        }) => void)
        | null;
      onresult:
        | ((event: {
          readonly results: ArrayLike<
            ArrayLike<{
              readonly transcript: string;
            }> & {
              readonly isFinal: boolean;
            }
          >;
        }) => void)
        | null;
    };
    webkitSpeechRecognition?: Window["SpeechRecognition"];
  }
}

const useSubmitTurn = () => {
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const activeSessionResult = useAtomValue(activeSessionResultAtom);
  const form = useAtomValue(simulatorFormAtom);
  const startCallRun = useAtomSet(startCallRunAtom);
  const setForm = useAtomSet(simulatorFormAtom);

  return React.useCallback((utterance: string) => {
    const selectedSession =
      activeSessionResult !== null && AsyncResult.isSuccess(activeSessionResult)
        ? activeSessionResult.value
        : null;

    startCallRun({
      sessionId: activeSessionId,
      customerName: selectedSession?.customerName ?? form.customerName,
      phoneNumber: selectedSession?.phoneNumber ?? form.phoneNumber,
      email: selectedSession?.email ?? form.email,
      zipCode: selectedSession?.zipCode ?? form.zipCode,
      utterance,
    });
    setForm((current) => ({ ...current, utterance: "" }));
  }, [
    activeSessionId,
    activeSessionResult,
    form.customerName,
    form.email,
    form.phoneNumber,
    form.zipCode,
    setForm,
    startCallRun,
  ]);
};

const CallRunWatch = () => {
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const activeSessionResult = useAtomValue(activeSessionResultAtom);
  if (
    activeSessionId === null || activeSessionResult === null
    || !AsyncResult.isSuccess(activeSessionResult)
  ) {
    return null;
  }

  return <ActiveSessionWatch sessionId={activeSessionId} />;
};

const ActiveSessionWatch = (props: {
  readonly sessionId: CallSessionId;
}) => {
  useAtomValue(watchCallSessionFamily(props.sessionId));

  return null;
};

const VoiceConsole = () => {
  const [voiceMode, setVoiceMode] = useAtom(voiceModeAtom);
  const [autoSpeakAssistant, setAutoSpeakAssistant] = useAtom(autoSpeakAssistantAtom);
  const startCallRunResult = useAtomValue(startCallRunAtom);
  const liveCallRun = useAtomValue(activeCallRunStateAtom);
  const submitTurn = useSubmitTurn();
  const [isListening, setIsListening] = React.useState(false);
  const [interimTranscript, setInterimTranscript] = React.useState("");
  const [voiceStatus, setVoiceStatus] = React.useState<string | null>(null);
  const lastSpokenRunIdRef = React.useRef<string | null>(null);
  const recognitionRef = React.useRef<
    InstanceType<NonNullable<Window["SpeechRecognition"]>> | null
  >(null);

  const speakAssistantMessage = React.useCallback((message: string) => {
    if (!autoSpeakAssistant || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, [autoSpeakAssistant]);

  React.useEffect(() => {
    if (liveCallRun._tag !== "Completed" || lastSpokenRunIdRef.current === liveCallRun.runId) {
      return;
    }
    lastSpokenRunIdRef.current = liveCallRun.runId;
    speakAssistantMessage(liveCallRun.assistantMessage);
    setVoiceStatus(null);
  }, [liveCallRun, speakAssistantMessage]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (SpeechRecognition === undefined) {
      setVoiceMode("manual");
      setVoiceStatus("Browser voice is unavailable in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onend = () => {
      setIsListening(false);
    };
    recognition.onerror = (event) => {
      setIsListening(false);
      setVoiceStatus(`Voice capture error: ${event.error}`);
    };
    recognition.onresult = (event) => {
      let finalTranscript = "";
      let nextInterimTranscript = "";

      for (const result of Array.from(event.results)) {
        const transcript = Array.from(result).map((part) => part.transcript).join(" ").trim();
        if (result.isFinal) {
          finalTranscript = `${finalTranscript} ${transcript}`.trim();
        } else {
          nextInterimTranscript = `${nextInterimTranscript} ${transcript}`.trim();
        }
      }

      setInterimTranscript(nextInterimTranscript);
      if (finalTranscript.length === 0) {
        return;
      }
      setVoiceStatus(null);
      submitTurn(finalTranscript);
    };
    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [setVoiceMode, submitTurn]);

  const startVoiceCapture = () => {
    if (recognitionRef.current === null) {
      setVoiceMode("manual");
      setVoiceStatus("Browser voice is unavailable in this browser.");
      return;
    }
    setInterimTranscript("");
    setVoiceStatus(null);
    setIsListening(true);
    recognitionRef.current.start();
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-900">Input mode</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`rounded px-3 py-2 text-sm font-medium ${
              voiceMode === "browser-voice"
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-700"
            }`}
            onClick={() => {
              if (recognitionRef.current === null) {
                setVoiceMode("manual");
                setVoiceStatus("Browser voice is unavailable in this browser.");
                return;
              }
              setVoiceMode("browser-voice");
            }}
            type="button"
          >
            Voice
          </button>
          <button
            className={`rounded px-3 py-2 text-sm font-medium ${
              voiceMode === "manual"
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-700"
            }`}
            onClick={() => {
              setVoiceMode("manual");
              recognitionRef.current?.stop();
              setVoiceStatus(null);
            }}
            type="button"
          >
            Type
          </button>
        </div>
      </div>
      {voiceStatus === null
        ? null
        : <div className="mt-3 text-sm text-slate-600">{voiceStatus}</div>}
      {interimTranscript.length === 0
        ? null
        : <div className="mt-3 text-sm text-slate-600">{interimTranscript}</div>}
      {voiceMode !== "browser-voice"
        ? null
        : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:bg-slate-400"
              disabled={isListening || startCallRunResult.waiting}
              onClick={startVoiceCapture}
              type="button"
            >
              {isListening ? "Listening" : "Start voice turn"}
            </button>
            {isListening
              ? (
                <button
                  className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                  onClick={() => {
                    recognitionRef.current?.stop();
                    setVoiceStatus(null);
                  }}
                  type="button"
                >
                  Stop
                </button>
              )
              : null}
            <button
              className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
              onClick={() => {
                setAutoSpeakAssistant((current) => !current);
              }}
              type="button"
            >
              {autoSpeakAssistant ? "Auto speak on" : "Auto speak off"}
            </button>
          </div>
        )}
    </div>
  );
};

const NewCallForm = () => {
  const [form, setForm] = useAtom(simulatorFormAtom);
  const startCallRunResult = useAtomValue(startCallRunAtom);
  const submitTurn = useSubmitTurn();
  const setCreateCallPanelOpen = useAtomSet(createCallPanelOpenAtom);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submitTurn(form.utterance);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Start a new call</h2>
          <p className="mt-1 text-sm text-slate-600">Capture the caller and their first issue.</p>
        </div>
        <button
          className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:text-slate-900"
          onClick={() => {
            setCreateCallPanelOpen(false);
          }}
          type="button"
        >
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-slate-700">
          <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
            Caller
          </span>
          <input
            className="w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
            onChange={(event) => {
              setForm((current) => ({ ...current, customerName: event.target.value }));
            }}
            value={form.customerName}
          />
        </label>
        <label className="text-sm text-slate-700">
          <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
            Phone
          </span>
          <input
            className="w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
            onChange={(event) => {
              setForm((current) => ({ ...current, phoneNumber: event.target.value }));
            }}
            value={form.phoneNumber}
          />
        </label>
        <label className="text-sm text-slate-700">
          <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
            Email
          </span>
          <input
            className="w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
            onChange={(event) => {
              setForm((current) => ({ ...current, email: event.target.value }));
            }}
            value={form.email}
          />
        </label>
        <label className="text-sm text-slate-700">
          <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
            Zip code
          </span>
          <input
            className="w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
            onChange={(event) => {
              setForm((current) => ({ ...current, zipCode: event.target.value }));
            }}
            value={form.zipCode}
          />
        </label>
      </div>
      <label className="block text-sm text-slate-700">
        <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
          Opening issue
        </span>
        <textarea
          className="min-h-28 w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          onChange={(event) => {
            setForm((current) => ({ ...current, utterance: event.target.value }));
          }}
          value={form.utterance}
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <VoiceConsole />
        <button
          className="shrink-0 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:bg-slate-400"
          disabled={startCallRunResult.waiting || form.utterance.trim().length === 0}
          type="submit"
        >
          {startCallRunResult.waiting ? "Starting" : "Start call"}
        </button>
      </div>
    </form>
  );
};

const ContinueCallForm = () => {
  const [form, setForm] = useAtom(simulatorFormAtom);
  const activeSessionResult = useAtomValue(activeSessionResultAtom);
  const startCallRunResult = useAtomValue(startCallRunAtom);
  const setActiveSessionId = useAtomSet(activeSessionIdAtom);
  const setCreateCallPanelOpen = useAtomSet(createCallPanelOpenAtom);
  const submitTurn = useSubmitTurn();

  if (activeSessionResult === null || !AsyncResult.isSuccess(activeSessionResult)) {
    return null;
  }

  const session = activeSessionResult.value;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submitTurn(form.utterance);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Continue call</h2>
          <p className="mt-1 text-sm text-slate-600">
            {session.customerName} · {session.phoneNumber}
          </p>
        </div>
        <button
          className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:text-slate-900"
          onClick={() => {
            setActiveSessionId(null);
            setCreateCallPanelOpen(true);
          }}
          type="button"
        >
          New call
        </button>
      </div>
      <VoiceConsole />
      <label className="block text-sm text-slate-700">
        <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
          Next caller message
        </span>
        <textarea
          className="min-h-24 w-full rounded border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          onChange={(event) => {
            setForm((current) => ({ ...current, utterance: event.target.value }));
          }}
          value={form.utterance}
        />
      </label>
      <div className="flex justify-end">
        <button
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:bg-slate-400"
          disabled={startCallRunResult.waiting || form.utterance.trim().length === 0}
          type="submit"
        >
          {startCallRunResult.waiting ? "Sending" : "Send turn"}
        </button>
      </div>
    </form>
  );
};

const EmptyWorkspace = () => {
  const setCreateCallPanelOpen = useAtomSet(createCallPanelOpenAtom);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-slate-200 bg-white p-6">
      <div className="text-center">
        <h2 className="text-base font-semibold text-slate-900">Choose a call or start a new one</h2>
        <div className="mt-3">
          <button
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            onClick={() => {
              setCreateCallPanelOpen(true);
            }}
            type="button"
          >
            Start new call
          </button>
        </div>
      </div>
    </div>
  );
};

export const CallConsolePanel = () => {
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const createCallPanelOpen = useAtomValue(createCallPanelOpenAtom);

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <CallRunWatch />
      {createCallPanelOpen
        ? <NewCallForm />
        : activeSessionId === null
        ? <EmptyWorkspace />
        : <ContinueCallForm />}
    </section>
  );
};
