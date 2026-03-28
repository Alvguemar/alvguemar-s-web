const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_SYSTEM_PROMPT =
  "Eres un asistente util, claro y amable. Responde siempre en espanol salvo que el usuario pida otro idioma. Prioriza respuestas breves, practicas y conversacionales.";
const MAX_MESSAGES = 12;

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Usa POST en /api/chat." });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "Falta OPENAI_API_KEY en el backend." });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const conversation = normalizeConversation(body.messages);

    if (conversation.length === 0) {
      res.status(400).json({ error: "No se recibieron mensajes validos." });
      return;
    }

    const openaiResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        instructions: process.env.OPENAI_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT,
        input: conversation,
        store: false
      })
    });

    const payload = await openaiResponse.json();

    if (!openaiResponse.ok) {
      res.status(openaiResponse.status).json({
        error: payload.error?.message || "OpenAI devolvio un error."
      });
      return;
    }

    const reply = extractReplyText(payload);
    if (!reply) {
      res.status(502).json({ error: "OpenAI no devolvio texto utilizable." });
      return;
    }

    res.status(200).json({
      reply,
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Error interno del backend."
    });
  }
};

function applyCors(req, res) {
  const configuredOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const requestOrigin = req.headers.origin;

  let allowOrigin = "*";
  if (configuredOrigins.length > 0) {
    allowOrigin = configuredOrigins.includes(requestOrigin)
      ? requestOrigin
      : configuredOrigins[0];
  }

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }

  return raw ? JSON.parse(raw) : {};
}

function normalizeConversation(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => {
      return (
        message &&
        typeof message.text === "string" &&
        (message.role === "user" || message.role === "assistant")
      );
    })
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: [
        {
          type: "input_text",
          text: message.text.slice(0, 4000)
        }
      ]
    }));
}

function extractReplyText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks = [];

  for (const item of output) {
    if (!Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n\n").trim();
}
