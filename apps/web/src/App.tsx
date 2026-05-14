import { Mic, MicOff, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { startTranslationSession, type TranslationEvent, type TranslationSession } from "./realtimeTranslation";

type Status = "idle" | "connecting" | "active" | "error" | "stopped";

type MediaDevicesWithOutputPicker = MediaDevices & {
  selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;
};

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
  const [micLevel, setMicLevel] = useState(0);
  const [diagnostic, setDiagnostic] = useState("대기 중");
  const [lastEventType, setLastEventType] = useState("");
  const [lastEventJson, setLastEventJson] = useState("");
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputDeviceId, setInputDeviceId] = useState(() => localStorage.getItem("translation_input_device_id") ?? "");
  const [outputDeviceId, setOutputDeviceId] = useState(() => localStorage.getItem("translation_output_device_id") ?? "");
  const [eventLog, setEventLog] = useState<string[]>([]);

  const refreshDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(devices.filter((device) => device.kind === "audioinput"));
      setOutputDevices(devices.filter((device) => device.kind === "audiooutput"));
    } catch {
      setDiagnostic("장치 목록을 불러오지 못했습니다.");
    }
  };

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);

    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
    };
  }, []);

  const handleEvent = (event: TranslationEvent) => {
    setLastEventType(event.type);
    setLastEventJson(JSON.stringify(event).slice(0, 700));
    setEventLog((current) => [event.type, ...current.filter((type) => type !== event.type)].slice(0, 6));

    const payload = event as Record<string, unknown>;
    const delta =
      typeof payload.delta === "string"
        ? payload.delta
        : typeof payload.transcript === "string"
          ? payload.transcript
          : typeof payload.text === "string"
            ? payload.text
          : "";

    if (!delta) return;

    const eventType = event.type.toLowerCase();

    if (
      eventType.includes("output") ||
      eventType.includes("translation") ||
      eventType.includes("translated") ||
      eventType.includes("target") ||
      eventType.includes("response")
    ) {
      setTargetTranscript((current) => `${current}${delta}`);
    }

    if (eventType.includes("input") || eventType.includes("source")) {
      setSourceTranscript((current) => `${current}${delta}`);
    }
  };

  const copyDiagnostics = async () => {
    const content = [
      `status=${status}`,
      `diagnostic=${diagnostic}`,
      `micLevel=${Math.round(micLevel * 100)}%`,
      `lastEventType=${lastEventType || "none"}`,
      `eventLog=${eventLog.join(" / ") || "none"}`,
      `lastEventJson=${lastEventJson || "none"}`
    ].join("\n");

    await navigator.clipboard?.writeText(content).catch(() => undefined);
    setDiagnostic("진단 정보 복사됨");
  };

  const chooseOutputDevice = async () => {
    const mediaDevices = navigator.mediaDevices as MediaDevicesWithOutputPicker | undefined;

    if (!mediaDevices?.selectAudioOutput) {
      setDiagnostic("이 브라우저는 출력 장치 선택 팝업을 지원하지 않습니다. OS 기본 출력 장치를 이어폰으로 바꿔주세요.");
      return;
    }

    try {
      const device = await mediaDevices.selectAudioOutput(outputDeviceId ? { deviceId: outputDeviceId } : undefined);
      setOutputDeviceId(device.deviceId);
      localStorage.setItem("translation_output_device_id", device.deviceId);
      await refreshDevices();
      setDiagnostic(`${device.label || "선택한 출력 장치"}로 출력합니다.`);
    } catch {
      setDiagnostic("출력 장치 선택이 취소되었습니다.");
    }
  };

  const playOutputTest = async () => {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();
    const audio = new Audio();

    audio.autoplay = true;
    audio.srcObject = destination.stream;
    audio.setAttribute("playsinline", "true");
    audio.style.display = "none";

    if (outputDeviceId && "setSinkId" in audio) {
      await (audio as HTMLAudioElement & { setSinkId: (sinkId: string) => Promise<void> }).setSinkId(outputDeviceId);
    }

    document.body.appendChild(audio);
    oscillator.frequency.value = 740;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    await audio.play();

    window.setTimeout(() => {
      oscillator.stop();
      audio.pause();
      audio.remove();
      audioContext.close().catch(() => undefined);
    }, 420);
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
    setLastEventType("");
    setLastEventJson("");
    setEventLog([]);
    setMicLevel(0);
    setDiagnostic("연결 준비 중");

    try {
      sessionStorage.setItem("translation_access_code", accessCode.trim());
      localStorage.setItem("translation_input_device_id", inputDeviceId);
      localStorage.setItem("translation_output_device_id", outputDeviceId);
      const session = await startTranslationSession(accessCode.trim(), {
        inputDeviceId,
        outputDeviceId,
        onEvent: handleEvent,
        onDiagnostic: setDiagnostic,
        onMicLevel: setMicLevel
      });
      session.audioElement.muted = isMuted;
      sessionRef.current = session;
      setStatus("active");
    } catch (err) {
      sessionRef.current?.stop();
      sessionRef.current = null;
      setStatus("error");
      setError(err instanceof Error ? err.message : "통역을 시작하지 못했습니다.");
      setDiagnostic("오류");
    }
  };

  const stop = () => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setMicLevel(0);
    setDiagnostic("중지됨");
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
  const supportsOutputSelection = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  const supportsOutputPicker =
    typeof navigator !== "undefined" && Boolean((navigator.mediaDevices as MediaDevicesWithOutputPicker | undefined)?.selectAudioOutput);

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

        {isActive ? (
          <section className="diagnostics" aria-label="통역 연결 진단">
            <div>
              <span>마이크 입력</span>
              <div className="level-meter" aria-hidden="true">
                <div style={{ width: `${Math.round(micLevel * 100)}%` }} />
              </div>
            </div>
            <p>{diagnostic}</p>
            <p>{lastEventType ? `최근 이벤트: ${lastEventType}` : "이벤트 대기 중"}</p>
            {eventLog.length > 0 ? <p>이벤트 로그: {eventLog.join(" / ")}</p> : null}
            {lastEventType === "output_audio_buffer.started" && !targetTranscript ? (
              <p>번역 음성은 시작됐지만 자막 transcript 이벤트는 아직 수신되지 않았습니다.</p>
            ) : null}
            {lastEventJson ? <code className="event-json">{lastEventJson}</code> : null}
            <button className="secondary-button copy-diagnostics" type="button" onClick={copyDiagnostics}>
              진단 복사
            </button>
          </section>
        ) : null}

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
          <section className="setup-panel" aria-label="통역 시작 설정">
            <label>
              <span>접속 코드</span>
              <input
                type="password"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder="회사 내부 접속 코드"
                autoComplete="current-password"
              />
            </label>
            <label>
              <span>입력 마이크</span>
              <select value={inputDeviceId} onChange={(event) => setInputDeviceId(event.target.value)} onFocus={refreshDevices}>
                <option value="">브라우저 기본 마이크</option>
                {inputDevices.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {device.label || `마이크 ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            {supportsOutputSelection ? (
              <label>
                <span>출력 장치</span>
                <select value={outputDeviceId} onChange={(event) => setOutputDeviceId(event.target.value)} onFocus={refreshDevices}>
                  <option value="">브라우저 기본 출력</option>
                  {outputDevices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `출력 ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="device-actions">
              {supportsOutputPicker ? (
                <button className="secondary-button" type="button" onClick={chooseOutputDevice}>
                  출력 선택
                </button>
              ) : null}
              <button className="secondary-button" type="button" onClick={playOutputTest}>
                테스트 소리
              </button>
              <button className="secondary-button" type="button" onClick={refreshDevices}>
                장치 새로고침
              </button>
            </div>
          </section>
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
