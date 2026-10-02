"use client";

import { ArrowUp, FileText, Globe2, ImagePlus, Loader2, Mic, Paperclip, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConversationLinkPicker, LinkedConversationBadges } from "@/components/chat/conversation-link-picker";
import { useLocale } from "@/hooks/use-locale";
import { extractAttachmentText } from "@/lib/documents/extract";
import { attachmentKind, attachmentSizeLimit, composeMessageContent, MAX_ATTACHMENT_COUNT, prepareAttachments, type AttachmentInput } from "@/lib/documents/limits";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/chat";
import type { SearchProvider } from "@/types/memory";
import { DEFAULT_SEARCH_PROVIDER, SEARCH_PROVIDERS } from "@/lib/search/settings";

const SEARCH_PROVIDER_LABELS: Record<SearchProvider, { en: string; ar: string }> = {
  exa: { en: "Exa", ar: "Exa" },
  anysearch: { en: "AnySearch", ar: "AnySearch" },
  google_grounding: { en: "Gemini Grounding", ar: "تأريض Gemini" },
};

interface ChatInputProps {
  onSend: (content: string, displayContent?: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  webSearchEnabled?: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
  searchProvider?: SearchProvider;
  onSearchProviderChange?: (provider: SearchProvider) => void;
  conversation?: Conversation | null;
  conversations?: Conversation[];
  onLinkedConversationsChange?: (ids: string[]) => void;
}

interface PendingAttachment extends AttachmentInput { id: string; status: "reading" | "ready" | "error"; }

export function ChatInput({ onSend, disabled, isLoading, webSearchEnabled = false, onWebSearchChange, searchProvider = DEFAULT_SEARCH_PROVIDER, onSearchProviderChange, conversation = null, conversations = [], onLinkedConversationsChange }: ChatInputProps) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const reading = files.some((file) => file.status === "reading");

  useEffect(() => () => controllers.current.forEach((controller) => controller.abort()), []);

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
    const accepted = Array.from(selected).slice(0, Math.max(0, MAX_ATTACHMENT_COUNT - files.length));
    const pending = accepted.map((file): PendingAttachment => {
      const kind = attachmentKind(file);
      const error = kind === "unsupported"
        ? (ar ? "نوع الملف غير مدعوم" : "Unsupported file type")
        : file.size > attachmentSizeLimit(kind)
          ? (ar ? "الملف أكبر من الحد المسموح" : "File exceeds the size limit")
          : undefined;
      return { id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, status: error ? "error" : "reading", error };
    });
    setFiles((current) => [...current, ...pending].slice(0, MAX_ATTACHMENT_COUNT));
    pending.forEach((item, index) => {
      if (item.error) return;
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      void extractAttachmentText(accepted[index], undefined, controller.signal)
        .then((text) => setFiles((current) => current.map((file) => file.id === item.id ? { ...file, text, status: text.trim() ? "ready" : "error", error: text.trim() ? undefined : (ar ? "لم يتم العثور على نص" : "No text found") } : file)))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setFiles((current) => current.map((file) => file.id === item.id ? { ...file, status: "error", error: ar ? "تعذر قراءة الملف" : "Could not read file" } : file));
        })
        .finally(() => controllers.current.delete(item.id));
    });
  };

  const removeFile = (id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setFiles((current) => current.filter((file) => file.id !== id));
  };

  const handleSubmit = useCallback(() => {
    const value = textareaRef.current?.value.trim();
    if ((!value && !files.some((file) => file.text)) || disabled || isLoading || reading) return;
    const prepared = prepareAttachments(files);
    const message = composeMessageContent(value ?? "", prepared);
    if (!message.content) return;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    onSend(message.content, message.displayContent);
    setFiles([]);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
  }, [files, onSend, disabled, isLoading, reading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background from-75% to-transparent px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4">
      <div className="surface-elevated mx-auto max-w-3xl rounded-3xl border border-border/80 bg-card p-2 shadow-lg sm:p-3">
        {files.length > 0 && <div className="mb-2 flex flex-wrap gap-2 px-1">{files.map((file) => <div key={file.id} className={cn("flex items-center gap-2 rounded-lg border bg-muted/60 px-2 py-1.5 text-xs", file.status === "error" && "border-destructive/40 text-destructive")}><span className="flex size-6 items-center justify-center rounded bg-background">{file.status === "reading" ? <Loader2 className="size-3.5 animate-spin" aria-label={ar ? "جارٍ قراءة الملفات" : "Reading files"} /> : file.type.startsWith("image/") ? <ImagePlus className="size-3.5" /> : <FileText className="size-3.5" />}</span><span className="max-w-40 truncate">{file.name}</span><span className="sr-only">{file.error ?? file.status}</span><button type="button" onClick={() => removeFile(file.id)} aria-label={ar ? `إزالة ${file.name}` : `Remove ${file.name}`}><X className="size-3.5 text-muted-foreground" /></button></div>)}</div>}
        {voiceError && <p className="mb-2 px-1 text-xs text-destructive" role="alert">{voiceError}</p>}
        <LinkedConversationBadges conversation={conversation} conversations={conversations} onChange={(ids) => onLinkedConversationsChange?.(ids)} />
        <div className="flex touch-manipulation items-end gap-1.5 sm:gap-2">
        <ConversationLinkPicker conversation={conversation} conversations={conversations} disabled={disabled || isLoading} onChange={(ids) => onLinkedConversationsChange?.(ids)} />
        <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.docx,.txt,.md,.csv" className="sr-only" onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} />
         <Button type="button" variant="ghost" size="icon" className="mb-0.5 shrink-0 rounded-xl" onClick={() => fileRef.current?.click()} disabled={disabled || isLoading || files.length >= MAX_ATTACHMENT_COUNT} aria-label={ar ? "إرفاق صور أو ملفات" : "Attach images or files"}><Paperclip className="size-4" /></Button>
         <Button type="button" variant={isRecording ? "secondary" : "ghost"} size="icon" className={`mb-0.5 shrink-0 rounded-xl ${isRecording ? "text-destructive ring-1 ring-destructive/30" : ""}`} onClick={() => void toggleRecording()} disabled={disabled || isLoading || isTranscribing} aria-label={isRecording ? (ar ? "إيقاف التسجيل" : "Stop recording") : (isTranscribing ? (ar ? "جارٍ تحويل الصوت إلى نص" : "Transcribing audio") : (ar ? "تسجيل رسالة صوتية" : "Record voice message"))} title={ar ? "تحويل الكلام إلى نص" : "Convert speech to text"}>{isTranscribing ? <Loader2 className="size-4 animate-spin" /> : isRecording ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}</Button>
        <Button
          type="button"
          variant={webSearchEnabled ? "secondary" : "ghost"}
          size="sm"
          className={`mb-0.5 h-9 shrink-0 gap-1.5 rounded-xl px-2 transition-colors sm:px-2.5 ${webSearchEnabled ? "bg-primary/12 text-primary ring-1 ring-primary/25 hover:bg-primary/20" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => onWebSearchChange?.(!webSearchEnabled)}
          disabled={disabled || isLoading}
          aria-pressed={webSearchEnabled}
          aria-label={webSearchEnabled ? (ar ? "إيقاف بحث الويب" : "Turn off web search") : (ar ? "تفعيل بحث الويب" : "Turn on web search")}
          title={ar ? "بحث الويب: يستهلك من حصتك" : "Web search: consumes your search quota"}
        >
          <Globe2 className={`size-4 ${webSearchEnabled ? "text-primary" : ""}`} />
          <span className="hidden text-xs font-medium sm:inline">{ar ? "بحث الويب" : "Web search"}</span>
          <span className={`hidden rounded-full px-1.5 py-0.5 text-[10px] leading-none sm:inline ${webSearchEnabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
            {webSearchEnabled ? (ar ? "مفعّل" : "On") : (ar ? "متوقف" : "Off")}
          </span>
        </Button>
        {webSearchEnabled && (
          <select
            value={searchProvider}
            onChange={(event) => onSearchProviderChange?.(event.target.value as SearchProvider)}
            disabled={disabled || isLoading}
            aria-label={ar ? "مزود بحث الويب" : "Web search provider"}
            title={ar ? "مزود بحث الويب المستخدم لهذا البحث" : "The web search provider used for this search"}
            className="mb-0.5 h-9 shrink-0 rounded-xl border border-border bg-background px-2 text-[11px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            {SEARCH_PROVIDERS.map((item) => (
              <option key={item} value={item}>
                {SEARCH_PROVIDER_LABELS[item][ar ? "ar" : "en"]}
              </option>
            ))}
          </select>
        )}
        <Textarea
          ref={textareaRef}
          placeholder={
            isLoading ? (ar ? "بانتظار الرد..." : "Waiting for response...") : (ar ? "اكتب رسالتك إلى PermaMind..." : "Message PermaMind...")
          }
          className="mb-0.5 min-h-11 min-w-0 flex-1 resize-none rounded-2xl border-0 bg-background/40 px-3 py-2.5 text-base shadow-none focus-visible:ring-1 sm:text-sm"
          rows={1}
          aria-label={ar ? "رسالة إلى PermaMind" : "Message PermaMind"}
          data-chat-composer
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
          className="mb-0.5 size-10 shrink-0 rounded-2xl"
          onClick={handleSubmit}
          disabled={disabled || isLoading || reading}
          aria-label={isLoading || reading ? (ar ? "جارٍ إنشاء الرد" : "Generating response") : (ar ? "إرسال الرسالة" : "Send message")}
        >
          {isLoading || reading ? (
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
