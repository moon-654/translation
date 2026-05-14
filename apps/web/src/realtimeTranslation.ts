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

export const startTranslationSession = async (
  accessCode: string,
  onEvent: (event: TranslationEvent) => void
): Promise<TranslationSession> => {
  const clientSecret = await getClientSecret(accessCode);
  const sourceStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  const peerConnection = new RTCPeerConnection();
  const sourceTrack = sourceStream.getAudioTracks()[0];
  peerConnection.addTrack(sourceTrack, sourceStream);

  const audioElement = new Audio();
  audioElement.autoplay = true;
  audioElement.setAttribute("playsinline", "true");

  peerConnection.ontrack = ({ streams }) => {
    audioElement.srcObject = streams[0];
  };

  const events = peerConnection.createDataChannel("oai-events");
  events.onmessage = ({ data }) => {
    try {
      onEvent(JSON.parse(data) as TranslationEvent);
    } catch {
      onEvent({ type: "client.unparseable_event" });
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

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

  const stop = () => {
    events.close();
    peerConnection.getSenders().forEach((sender) => sender.track?.stop());
    sourceStream.getTracks().forEach((track) => track.stop());
    peerConnection.close();
    audioElement.pause();
    audioElement.srcObject = null;
  };

  return { peerConnection, sourceStream, audioElement, stop };
};
