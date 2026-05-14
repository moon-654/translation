import { Mic, MicOff, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";
import { startTranslationSession, type TranslationEvent, type TranslationSession } from "./realtimeTranslation";

type Status = "idle" | "connecting" | "active" | "error" | "stopped";

const statusText: Record<Status, string> = {
  idle: "대기 중",
  connecting: "연결 중",
  active: "통역 중",
  error: "오류",
  stopped: "중지됨"
};

export function App() {
  const sessionRef = useRef<TranslationSession | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [targetTranscript, setTargetTranscript] = useState("");
  const [sourceTranscript, setSourceTranscript] = useState("");
  const [error, setError] = useState("");
  const [accessCode, setAccessCode] = useState(() => sessionStorage.getItem("translation_access_code") ?? "");

  const handleEvent = (event: TranslationEvent) => {
    if (event.type === "session.output_transcript.delta" && typeof event.delta === "string") {
      setTargetTranscript((current) => `${current}${event.delta}`);
    }

    if (event.type === "session.input_transcript.delta" && typeof event.delta === "string") {
      setSourceTranscript((current) => `${current}${event.delta}`);
    }
  };

  const start = async () => {
    if (!accessCode.trim()) {
      setStatus("error");
      setError("접속 코드를 입력하세요.");
      return;
    }

    setStatus("connecting");
    setError("");
    setTargetTranscript("");
    setSourceTranscript("");

    try {
      sessionStorage.setItem("translation_access_code", accessCode.trim());
      const session = await startTranslationSession(accessCode.trim(), handleEvent);
      session.audioElement.muted = isMuted;
      sessionRef.current = session;
      setStatus("active");
    } catch (err) {
      sessionRef.current?.stop();
      sessionRef.current = null;
      setStatus("error");
      setError(err instanceof Error ? err.message : "통역을 시작하지 못했습니다.");
    }
  };

  const stop = () => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus("stopped");
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    if (sessionRef.current) {
      sessionRef.current.audioElement.muted = nextMuted;
    }
  };

  const canStart = status === "idle" || status === "stopped" || status === "error";
  const isActive = status === "active" || status === "connecting";

  return (
    <main className="app-shell">
      <section className="console" aria-label="일본어 한국어 실시간 통역 콘솔">
        <header className="topbar">
          <div>
            <h1>일본어 한국어 회의 통역</h1>
            <p>태블릿을 회의 테이블 중앙에 두고 시작하세요.</p>
          </div>
          <div className={`status status-${status}`} aria-live="polite">
            {status === "active" ? <Mic size={18} /> : <MicOff size={18} />}
            <span>{statusText[status]}</span>
          </div>
        </header>

        <section className="caption-panel" aria-live="polite">
          <p className="caption-label">한국어 통역 자막</p>
          <div className="caption-text">
            {targetTranscript || (isActive ? "일본어 음성을 기다리는 중입니다." : "시작 버튼을 누르면 통역 자막이 표시됩니다.")}
          </div>
        </section>

        {showSource ? (
          <section className="source-panel" aria-live="polite">
            <p className="caption-label">일본어 원문</p>
            <div>{sourceTranscript || "원문 transcript가 도착하면 여기에 표시됩니다."}</div>
          </section>
        ) : null}

        {error ? (
          <div className="error-panel" role="alert">
            {error}
          </div>
        ) : null}

        {canStart ? (
          <label className="access-code">
            <span>접속 코드</span>
            <input
              type="password"
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="회사 내부 접속 코드"
              autoComplete="current-password"
            />
          </label>
        ) : null}

        <footer className="controls">
          {canStart ? (
            <button className="primary-button" type="button" onClick={start}>
              <Play size={22} />
              시작
            </button>
          ) : (
            <button className="danger-button" type="button" onClick={stop}>
              <Pause size={22} />
              중지
            </button>
          )}

          <button className="icon-button" type="button" onClick={toggleMute} title={isMuted ? "음성 켜기" : "음소거"}>
            {isMuted ? <VolumeX size={22} /> : <Volume2 size={22} />}
          </button>

          <button className="secondary-button" type="button" onClick={() => setShowSource((value) => !value)}>
            원문 {showSource ? "숨기기" : "보기"}
          </button>

          <button
            className="icon-button"
            type="button"
            onClick={() => {
              setTargetTranscript("");
              setSourceTranscript("");
              setError("");
            }}
            title="자막 초기화"
          >
            <RotateCcw size={22} />
          </button>
        </footer>
      </section>
    </main>
  );
}
