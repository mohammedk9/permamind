"use client";

import { ArrowUp, FileText, Globe2, ImagePlus, Loader2, Mic, Paperclip, Square, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/hooks/use-locale";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  webSearchEnabled?: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
}

export function ChatInput({ onSend, disabled, isLoading, webSearchEnabled = false, onWebSearchChange }: ChatInputProps) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const transcribe = useCallback(async (blob: Blob) => {
    setIsTranscribing(true);
    setVoiceError(null);
    try {
      const form = new FormData();
      form.append("audio", new File([blob], "recording.webm", { type: blob.type || "audio/webm" }));
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? `Transcription failed (${response.status})`);
      const current = textareaRef.current;
      if (current && data.text) {
        current.value = `${current.value.trim()}${current.value.trim() ? " " : ""}${data.text}`;
        current.style.height = "auto";
        current.style.height = `${Math.min(current.scrollHeight, 160)}px`;
      }
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : (ar ? "تعذر تحويل الصوت إلى نص" : "Could not transcribe audio"));
    } finally {
      setIsTranscribing(false);
    }
  }, [ar]);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    recordingTimerRef.current = null;
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      return;
    }
    if (isTranscribing || disabled || isLoading || !navigator.mediaDevices?.getUserMedia) return;
    setVoiceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = () => { const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }); if (blob.size > 0) void transcribe(blob); };
      recorderRef.current = recorder;
      streamRef.current = stream;
      recorder.start();
      setIsRecording(true);
      recordingTimerRef.current = setTimeout(stopRecording, 5 * 60 * 1000);
    } catch {
      setVoiceError(ar ? "تعذر الوصول إلى الميكروفون" : "Microphone access was denied or unavailable");
    }
  }, [ar, disabled, isLoading, isRecording, isTranscribing, stopRecording, transcribe]);

  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    setFiles((current) => [...current, ...Array.from(selected)].slice(0, 5));
  };

  const handleSubmit = useCallback(() => {
    const value = textareaRef.current?.value.trim();
    if ((!value && files.length === 0) || disabled || isLoading) return;
    const attachmentText = files.length ? `\n\n[Attachments: ${files.map((file) => file.name).join(", ")}]` : "";
    onSend(`${value}${attachmentText}`.trim());
    setFiles([]);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
  }, [files, onSend, disabled, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-background/95 p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:p-4">
      <div className="surface-elevated mx-auto max-w-3xl rounded-2xl border border-input bg-card p-2 sm:p-3">
        {files.length > 0 && <div className="mb-2 flex flex-wrap gap-2 px-1">{files.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg border bg-muted/60 px-2 py-1.5 text-xs"><span className="flex size-6 items-center justify-center rounded bg-background">{file.type.startsWith("image/") ? <ImagePlus className="size-3.5" /> : <FileText className="size-3.5" />}</span><span className="max-w-40 truncate">{file.name}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X className="size-3.5 text-muted-foreground" /></button></div>)}</div>}
        {voiceError && <p className="mb-2 px-1 text-xs text-destructive" role="alert">{voiceError}</p>}
        <div className="flex items-end gap-2">
        <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.doc,.docx,.csv" className="sr-only" onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} />
         <Button type="button" variant="ghost" size="icon" className="mb-0.5 rounded-xl" onClick={() => fileRef.current?.click()} disabled={disabled || isLoading} aria-label={ar ? "إرفاق صور أو ملفات" : "Attach images or files"}><Paperclip className="size-4" /></Button>
         <Button type="button" variant={isRecording ? "secondary" : "ghost"} size="icon" className={`mb-0.5 rounded-xl ${isRecording ? "text-destructive ring-1 ring-destructive/30" : ""}`} onClick={() => void toggleRecording()} disabled={disabled || isLoading || isTranscribing} aria-label={isRecording ? (ar ? "إيقاف التسجيل" : "Stop recording") : (isTranscribing ? (ar ? "جارٍ تحويل الصوت إلى نص" : "Transcribing audio") : (ar ? "تسجيل رسالة صوتية" : "Record voice message"))} title={ar ? "تحويل الكلام إلى نص" : "Convert speech to text"}>{isTranscribing ? <Loader2 className="size-4 animate-spin" /> : isRecording ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}</Button>
        <Button
          type="button"
          variant={webSearchEnabled ? "secondary" : "ghost"}
          size="sm"
          className={`mb-0.5 h-9 shrink-0 gap-1.5 rounded-xl px-2.5 transition-colors ${webSearchEnabled ? "bg-primary/12 text-primary ring-1 ring-primary/25 hover:bg-primary/20" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => onWebSearchChange?.(!webSearchEnabled)}
          disabled={disabled || isLoading}
          aria-pressed={webSearchEnabled}
          aria-label={webSearchEnabled ? (ar ? "إيقاف بحث الويب" : "Turn off web search") : (ar ? "تفعيل بحث الويب" : "Turn on web search")}
          title={ar ? "بحث الويب: يستخدم Exa ويستهلك من حصتك" : "Web search: uses Exa and consumes your search quota"}
        >
          <Globe2 className={`size-4 ${webSearchEnabled ? "text-primary" : ""}`} />
          <span className="hidden text-xs font-medium sm:inline">{ar ? "بحث الويب" : "Web search"}</span>
          <span className={`hidden rounded-full px-1.5 py-0.5 text-[10px] leading-none sm:inline ${webSearchEnabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
            {webSearchEnabled ? (ar ? "مفعّل" : "On") : (ar ? "متوقف" : "Off")}
          </span>
        </Button>
        <Textarea
          ref={textareaRef}
          placeholder={
            isLoading ? (ar ? "بانتظار الرد..." : "Waiting for response...") : (ar ? "اكتب رسالتك إلى PermaMind..." : "Message PermaMind...")
          }
          className="min-h-[44px] max-h-40 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          rows={1}
          aria-label={ar ? "رسالة إلى PermaMind" : "Message PermaMind"}
          aria-describedby="composer-help"
          disabled={disabled || isLoading}
          onKeyDown={handleKeyDown}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
          }}
        />
        <span id="composer-help" className="sr-only">{ar ? "اضغط Enter للإرسال، وShift+Enter لسطر جديد." : "Press Enter to send. Press Shift+Enter for a new line."}</span>
        <Button
          size="icon"
          className="shrink-0 rounded-xl"
          onClick={handleSubmit}
          disabled={disabled || isLoading}
          aria-label={isLoading ? (ar ? "جارٍ إنشاء الرد" : "Generating response") : (ar ? "إرسال الرسالة" : "Send message")}
        >
          {isLoading ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <ArrowUp aria-hidden="true" className="size-4" />
          )}
        </Button>
        </div>
      </div>
    </div>
  );
}
