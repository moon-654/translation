export type TranslationEvent =
  | { type: "session.output_transcript.delta"; delta: string }
  | { type: "session.input_transcript.delta"; delta: string }
  | { type: string; [key: string]: unknown };

export type TranslationSession = {
  peerConnection: RTCPeerConnection;
  sourceStream: MediaStream;
  audioElement: HTMLAudioElement;
  stop: () => void;
};

type TranslationSessionCallbacks = {
  onEvent: (event: TranslationEvent) => void;
  onDiagnostic?: (message: string) => void;
  onMicLevel?: (level: number) => void;
};

type SessionResponse = {
  value?: string;
  client_secret?: {
    value?: string;
  };
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

const getClientSecret = async (accessCode: string) => {
  const response = await fetch(`${API_BASE_URL}/api/realtime/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Access-Code": accessCode
    },
    body: JSON.stringify({ sourceLanguage: "ja", targetLanguage: "ko" })
  });

  const body = (await response.json().catch(() => null)) as
    | (SessionResponse & { message?: string })
    | null;

  if (!response.ok || !body) {
    throw new Error(body?.message ?? "통역 세션을 만들지 못했습니다.");
  }

  const clientSecret = body.value ?? body.client_secret?.value;

  if (!clientSecret) {
    throw new Error("통역 세션 응답에 client secret이 없습니다.");
  }

  return clientSecret;
};

const ensureMicrophoneAvailable = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("이 브라우저에서 마이크를 사용할 수 없습니다. Chrome 또는 Edge 최신 버전에서 다시 시도하세요.");
  }

  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const hasAudioInput = devices.some((device) => device.kind === "audioinput");

  if (devices.length > 0 && !hasAudioInput) {
    throw new Error("마이크 입력 장치를 찾지 못했습니다. 태블릿/PC 마이크를 켜거나 USB/블루투스 마이크를 연결하세요.");
  }
};

const explainMicrophoneError = (error: unknown) => {
  if (!(error instanceof DOMException)) {
    return error instanceof Error ? error.message : "마이크를 시작하지 못했습니다.";
  }

  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "마이크 입력 장치를 찾지 못했습니다. Windows 설정과 Chrome/Edge 사이트 권한에서 마이크가 사용 가능한지 확인하세요.";
  }

  if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
    return "마이크 권한이 차단되었습니다. 주소창 왼쪽의 사이트 설정에서 마이크 권한을 허용하세요.";
  }

  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "다른 앱이 마이크를 사용 중일 수 있습니다. Zoom, Teams, 녹음 앱을 닫고 다시 시도하세요.";
  }

  return error.message || "마이크를 시작하지 못했습니다.";
};

export const startTranslationSession = async (
  accessCode: string,
  { onEvent, onDiagnostic, onMicLevel }: TranslationSessionCallbacks
): Promise<TranslationSession> => {
  onDiagnostic?.("통역 세션 생성 중");
  const clientSecret = await getClientSecret(accessCode);
  onDiagnostic?.("마이크 권한 확인 중");
  await ensureMicrophoneAvailable();

  let sourceStream: MediaStream;

  try {
    sourceStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  } catch (error) {
    throw new Error(explainMicrophoneError(error));
  }

  onDiagnostic?.("마이크 입력 연결됨");
  const audioContext = new AudioContext();
  const sourceNode = audioContext.createMediaStreamSource(sourceStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  sourceNode.connect(analyser);

  const samples = new Uint8Array(analyser.frequencyBinCount);
  let isStopped = false;

  const readMicLevel = () => {
    if (isStopped) return;

    analyser.getByteTimeDomainData(samples);
    let peak = 0;

    for (const sample of samples) {
      peak = Math.max(peak, Math.abs(sample - 128));
    }

    onMicLevel?.(Math.min(1, peak / 64));
    requestAnimationFrame(readMicLevel);
  };

  readMicLevel();

  const peerConnection = new RTCPeerConnection();
  peerConnection.onconnectionstatechange = () => {
    onDiagnostic?.(`WebRTC ${peerConnection.connectionState}`);
  };
  peerConnection.oniceconnectionstatechange = () => {
    onDiagnostic?.(`ICE ${peerConnection.iceConnectionState}`);
  };

  const sourceTrack = sourceStream.getAudioTracks()[0];
  peerConnection.addTrack(sourceTrack, sourceStream);

  const audioElement = new Audio();
  audioElement.autoplay = true;
  audioElement.setAttribute("playsinline", "true");
  audioElement.style.display = "none";
  document.body.appendChild(audioElement);

  peerConnection.ontrack = ({ streams }) => {
    onDiagnostic?.("한국어 음성 트랙 수신 중");
    audioElement.srcObject = streams[0];
    audioElement.play().catch(() => {
      onDiagnostic?.("브라우저가 자동 재생을 막았습니다. 음소거 버튼을 한 번 눌렀다가 다시 시도하세요.");
    });
  };

  const events = peerConnection.createDataChannel("oai-events");
  events.onopen = () => onDiagnostic?.("Realtime 이벤트 채널 연결됨");
  events.onerror = () => onDiagnostic?.("Realtime 이벤트 채널 오류");
  events.onmessage = ({ data }) => {
    try {
      onEvent(JSON.parse(data) as TranslationEvent);
    } catch {
      onEvent({ type: "client.unparseable_event" });
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  onDiagnostic?.("OpenAI WebRTC 연결 중");

  const sdpResponse = await fetch("https://api.openai.com/v1/realtime/translations/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "Content-Type": "application/sdp"
    },
    body: offer.sdp
  });

  if (!sdpResponse.ok) {
    throw new Error(await sdpResponse.text());
  }

  await peerConnection.setRemoteDescription({
    type: "answer",
    sdp: await sdpResponse.text()
  });
  onDiagnostic?.("OpenAI WebRTC answer 수신됨");

  const stop = () => {
    isStopped = true;
    audioContext.close().catch(() => undefined);
    events.close();
    peerConnection.getSenders().forEach((sender) => sender.track?.stop());
    sourceStream.getTracks().forEach((track) => track.stop());
    peerConnection.close();
    audioElement.pause();
    audioElement.srcObject = null;
    audioElement.remove();
  };

  return { peerConnection, sourceStream, audioElement, stop };
};
