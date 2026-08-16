import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  } catch {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "Voice transcription is not configured" }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid audio upload" }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) {
    return Response.json({ error: "An audio recording is required" }, { status: 400 });
  }
  if (audio.size === 0 || audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio must be between 1 byte and 25 MB" }, { status: 413 });
  }

  const upstreamForm = new FormData();
  upstreamForm.append("file", audio, audio.name || "recording.webm");
  upstreamForm.append("model", "whisper-large-v3-turbo");
  upstreamForm.append("response_format", "json");

  try {
    const response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstreamForm,
    });

    const data = (await response.json().catch(() => ({}))) as {
      text?: string;
      error?: { message?: string } | string;
    };
    if (!response.ok) {
      const providerError = typeof data.error === "string" ? data.error : data.error?.message;
      return Response.json(
        { error: providerError ?? `Transcription failed (${response.status})` },
        { status: response.status === 429 ? 429 : 502 },
      );
    }

    const text = data.text?.trim();
    if (!text) return Response.json({ error: "No speech was detected" }, { status: 422 });
    return Response.json({ text });
  } catch {
    return Response.json({ error: "Could not reach the transcription service" }, { status: 502 });
  }
}