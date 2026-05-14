import cors from "cors";
import express from "express";
import { z } from "zod";
import { config, publicConfig } from "./config.js";

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

const sessionRequestSchema = z
  .object({
    targetLanguage: z.literal(config.targetLanguage).optional(),
    sourceLanguage: z.literal(config.sourceLanguage).optional(),
    safetyIdentifier: z.string().min(8).max(128).optional()
  })
  .strict();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/config", (_req, res) => {
  res.json(publicConfig);
});

app.post("/api/realtime/session", async (req, res) => {
  const parsed = sessionRequestSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      message: "This MVP only supports Japanese source audio and Korean output."
    });
    return;
  }

  if (!config.openAiApiKey) {
    res.status(500).json({
      error: "missing_openai_api_key",
      message: "OPENAI_API_KEY is not configured on the API server."
    });
    return;
  }

  const response = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": parsed.data.safetyIdentifier ?? "tablet-meeting-user"
    },
    body: JSON.stringify({
      session: {
        model: config.realtimeModel,
        audio: {
          output: {
            language: config.targetLanguage
          }
        }
      }
    })
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    res.status(response.status).json({
      error: "openai_session_error",
      message: "Could not create a realtime translation session.",
      details: body
    });
    return;
  }

  res.status(response.status).json(body);
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({
    error: "internal_server_error",
    message: "Unexpected API server error."
  });
});

app.listen(config.port, () => {
  console.log(`Realtime translation API listening on :${config.port}`);
});
