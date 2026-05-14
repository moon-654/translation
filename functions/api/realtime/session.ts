type Env = {
  OPENAI_API_KEY?: string;
  OPENAI_REALTIME_TRANSLATION_MODEL?: string;
  SOURCE_LANGUAGE?: string;
  TARGET_LANGUAGE?: string;
  SESSION_MAX_MINUTES?: string;
  APP_ACCESS_CODE?: string;
  ALLOWED_CLIENT_IPS?: string;
};

type PagesContext = {
  request: Request;
  env: Env;
};

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

const getClientIp = (request: Request) => request.headers.get("cf-connecting-ip") ?? "";

const isAllowedIp = (request: Request, allowedClientIps?: string) => {
  if (!allowedClientIps?.trim()) return true;

  const clientIp = getClientIp(request);
  const allowed = allowedClientIps
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

  return allowed.includes(clientIp);
};

const validateAccessCode = (request: Request, configuredCode?: string) => {
  if (!configuredCode?.trim()) {
    return false;
  }

  return request.headers.get("x-app-access-code") === configuredCode;
};

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Access-Code"
    }
  });

export const onRequestPost = async ({ request, env }: PagesContext) => {
  if (!env.OPENAI_API_KEY) {
    return json(
      {
        error: "missing_openai_api_key",
        message: "OPENAI_API_KEY secret is not configured."
      },
      { status: 500 }
    );
  }

  if (!validateAccessCode(request, env.APP_ACCESS_CODE)) {
    return json(
      {
        error: "invalid_access_code",
        message: "접속 코드가 필요합니다."
      },
      { status: 401 }
    );
  }

  if (!isAllowedIp(request, env.ALLOWED_CLIENT_IPS)) {
    return json(
      {
        error: "ip_not_allowed",
        message: "허용된 회사 네트워크에서만 사용할 수 있습니다."
      },
      { status: 403 }
    );
  }

  const sourceLanguage = env.SOURCE_LANGUAGE ?? "ja";
  const targetLanguage = env.TARGET_LANGUAGE ?? "ko";
  const realtimeModel = env.OPENAI_REALTIME_TRANSLATION_MODEL ?? "gpt-realtime-translate";
  const sessionMaxMinutes = Number(env.SESSION_MAX_MINUTES ?? "60");

  const body = await request.json().catch(() => ({}));

  if (
    typeof body !== "object" ||
    body === null ||
    ("sourceLanguage" in body && body.sourceLanguage !== sourceLanguage) ||
    ("targetLanguage" in body && body.targetLanguage !== targetLanguage)
  ) {
    return json(
      {
        error: "invalid_request",
        message: "This MVP only supports Japanese source audio and Korean output."
      },
      { status: 400 }
    );
  }

  const response = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "tablet-meeting-user"
    },
    body: JSON.stringify({
      session: {
        model: realtimeModel,
        expires_after: {
          anchor: "created_at",
          seconds: Math.max(60, Math.min(sessionMaxMinutes * 60, 3600))
        },
        audio: {
          output: {
            language: targetLanguage
          }
        }
      }
    })
  });

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    return json(
      {
        error: "openai_session_error",
        message: "Could not create a realtime translation session.",
        details: responseBody
      },
      { status: response.status }
    );
  }

  return json(responseBody, { status: response.status });
};
