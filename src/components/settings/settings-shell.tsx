"use client";

import { Check, ChevronDown, Copy, KeyRound, Laptop, LockKeyhole, RotateCcw, Sparkles, UploadCloud } from "lucide-react";
import { useState } from "react";
import type { ConnectionStatus } from "@/hooks/use-api-settings";
import type { AiProvider } from "@/lib/settings/api-key-storage";
import type { ChatPlan } from "@/lib/chat/plans";
import { cn } from "@/lib/utils";
import { resetFirstRun } from "@/lib/settings/first-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StatusPill } from "@/components/ui/status-pill";
import { useLocale } from "@/hooks/use-locale";
import type { Conversation } from "@/types/chat";
import { buildMcpExport, type McpContentLevel } from "@/lib/mcp/export";
import { downloadJson } from "@/lib/storage/download";
import { FullExportPanel } from "@/components/settings/full-export-panel";
import { RoomKeyPanel } from "@/components/settings/room-key-panel";

type Props = {
  apiKey: string; provider: AiProvider; onProviderChange: (provider: AiProvider) => void; baseUrl: string; onBaseUrlChange: (value: string) => void; modelName: string; onModelNameChange: (value: string) => void; connectionStatus: ConnectionStatus;
  /** Which of the three ways of getting replies is selected. */
  plan: ChatPlan;
  onPlanChange: (plan: ChatPlan) => void;
  /** The on-device embedding model: the switch state and its loading progress. */
  semantic: { enabled: boolean; status: "off" | "loading" | "ready" | "error"; progress: number };
  onToggleSemantic: (next: boolean) => void;
  onApiKeyChange: (key: string) => void;
  onValidate: () => Promise<boolean>; onClearKey: () => void;
  onClearAnalytics: () => void;
  conversations: Conversation[];
};

function Row({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-label">{label}</p><p className="mt-1 text-caption">{description}</p></div><div className="shrink-0">{children}</div></div>;
}

function McpExportPanel({ conversations }: { conversations: Conversation[] }) {
  const ar = useLocale().locale === "ar";
  const [selected, setSelected] = useState<string[]>([]);
  const [level, setLevel] = useState<McpContentLevel>("none");
  const [allowSearch, setAllowSearch] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const mcpUrl = typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`;
  const [mcpTokens, setMcpTokens] = useState<Array<{ id: string; label: string; expires_at: string; revoked_at: string | null }>>([]);
  const [issuedToken, setIssuedToken] = useState("");
  const [mcpMessage, setMcpMessage] = useState("");
  const loadMcpTokens = async () => {
    const response = await fetch("/api/mcp/tokens");
    if (!response.ok) return;
    const data = await response.json() as { tokens?: Array<{ id: string; label: string; expires_at: string; revoked_at: string | null }> };
    setMcpTokens(data.tokens ?? []);
  };
  const issueMcpToken = async () => {
    const response = await fetch("/api/mcp/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: "MCP client" }) });
    const data = await response.json() as { token?: string; error?: string };
    if (!response.ok || !data.token) return setMcpMessage(data.error ?? (ar ? "تعذر إنشاء الرمز" : "Token could not be created"));
    setIssuedToken(data.token);
    setMcpMessage(ar ? "انسخ الرمز الآن. لن يظهر مرة أخرى." : "Copy this token now. It will not be shown again.");
    await loadMcpTokens();
  };
  const revokeMcpToken = async (id: string) => {
    const response = await fetch(`/api/mcp/tokens?id=${id}`, { method: "DELETE" });
    if (response.ok) await loadMcpTokens();
  };
  const copyMcpUrl = async () => { await navigator.clipboard.writeText(mcpUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  const copyCodexConfig = async () => {
    const config = JSON.stringify({ mcpServers: { permamind: { url: mcpUrl, headers: { Authorization: "Bearer YOUR_MCP_TOKEN" } } } }, null, 2);
    await navigator.clipboard.writeText(config);
    setCopiedConfig(true);
    window.setTimeout(() => setCopiedConfig(false), 1800);
  };
  const download = (name: string, value: unknown) => downloadJson(value, name);
  const exportFiles = () => { const result = buildMcpExport(conversations, { conversationIds: selected, contentLevel: level, allowSearch }); download("permamind-data.json", result.data); download("mcp-policy.json", result.policy); };
  return <SurfaceCard title={ar ? "MCP وأدوات الذكاء الاصطناعي الخارجية" : "MCP & External AI Tools"} description={ar ? "اربط Cursor أو Claude بملخصات PermaMind المسموح بها، أو أنشئ تصديراً محلياً للقراءة فقط." : "Connect Cursor or Claude to approved PermaMind summaries, or create a local read-only export."}>
    <div className="space-y-4">
      <div className="rounded-md border border-primary/30 bg-primary/5 p-4 text-sm leading-relaxed">
        <p className="font-semibold">{ar ? "اتصال MCP السحابي" : "Cloud MCP connection"}</p>
        <p className="mt-1 text-muted-foreground">{ar ? "استخدم هذه النقطة للقراءة فقط مع Cursor أو Claude أو OpenAI Codex. تُكشف فقط الملخصات المسموح بها؛ ولا تُعاد المحادثات الكاملة أو النسخ الاحتياطية المشفرة أو المفاتيح الخاصة أبداً." : "Use this read-only endpoint with Cursor, Claude, or OpenAI Codex. Only summaries marked as allowed are exposed; full conversations, encrypted backups, and private keys are never returned."}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input readOnly value={mcpUrl} aria-label="MCP server URL" className="font-mono text-xs" /><Button type="button" size="sm" variant="outline" onClick={() => void copyMcpUrl()}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? (ar ? "تم النسخ" : "Copied") : (ar ? "نسخ الرابط" : "Copy URL")}</Button></div>
        <p className="mt-2 text-xs text-muted-foreground">{ar ? "أنشئ رمز MCP منفصلاً أدناه. لا تستخدم رمز جلسة Supabase، ويمكنك إلغاء رمز MCP وحده في أي وقت." : "Create the separate MCP token below. Do not use your Supabase session token; an MCP token can be revoked on its own."}</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" onClick={() => void issueMcpToken()}>{ar ? "إنشاء رمز MCP" : "Create MCP token"}</Button><Button type="button" size="sm" variant="outline" onClick={() => void loadMcpTokens()}>{ar ? "تحديث الرموز" : "Refresh tokens"}</Button></div>
        {issuedToken && <p className="mt-2 break-all rounded bg-background p-2 font-mono text-xs">{issuedToken}</p>}
        {mcpMessage && <p className="mt-2 text-xs">{mcpMessage}</p>}
        <div className="mt-2 space-y-1">{mcpTokens.filter((token) => !token.revoked_at).map((token) => <div key={token.id} className="flex items-center justify-between gap-2 text-xs"><span>{token.label} · {new Date(token.expires_at).toLocaleDateString()}</span><Button type="button" size="sm" variant="outline" onClick={() => void revokeMcpToken(token.id)}>{ar ? "إلغاء" : "Revoke"}</Button></div>)}</div>
        <Button type="button" size="sm" variant="outline" onClick={() => void copyCodexConfig()}>{copiedConfig ? <Check className="size-4" /> : <Copy className="size-4" />}{copiedConfig ? (ar ? "تم نسخ إعداد Codex" : "Codex config copied") : (ar ? "نسخ إعداد Codex" : "Copy Codex config")}</Button>
      </div>
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">{ar ? "قد يتم إرسال البيانات التي تسمح بها إلى Claude أو Cursor، وتخضع بعد ذلك لسياسة الخصوصية الخاصة بهما." : "Data you allow may be sent to Claude or Cursor, and is then subject to their privacy policies."}</div>
      <fieldset><legend className="text-label">{ar ? "المحادثات المسموح بها لـ MCP" : "Conversations allowed to MCP"}</legend><div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">{conversations.length === 0 ? <p className="p-2 text-caption">{ar ? "لا توجد محادثات متاحة." : "No conversations available."}</p> : conversations.map((conversation) => <label key={conversation.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"><input type="checkbox" checked={selected.includes(conversation.id)} onChange={() => setSelected((current) => current.includes(conversation.id) ? current.filter((id) => id !== conversation.id) : [...current, conversation.id])} />{conversation.title || (ar ? "محادثة بدون عنوان" : "Untitled conversation")}</label>)}</div></fieldset>
      <fieldset><legend className="text-label">{ar ? "مستوى المحتوى" : "Content level"}</legend><div className="mt-2 grid gap-2 sm:grid-cols-4">{(["none", "titles", "summaries", "messages"] as McpContentLevel[]).map((value) => <label key={value} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="radio" name="mcp-content-level" checked={level === value} onChange={() => setLevel(value)} />{value === "none" ? (ar ? "بدون" : "None") : value === "titles" ? (ar ? "العناوين" : "Titles") : value === "summaries" ? (ar ? "الملخصات" : "Summaries") : (ar ? "الرسائل الكاملة" : "Full messages")}</label>)}</div></fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowSearch} onChange={(event) => setAllowSearch(event.target.checked)} />{ar ? "السماح بالبحث عبر MCP" : "Allow MCP search"}</label>
      <p className="text-caption">{ar ? "يحتوي التصدير على المحادثات المحددة فقط، ولا يتضمن أبداً مفاتيح API أو كلمات المرور أو مفاتيح Arweave أو إعدادات Supabase أو أذونات الكتابة/الحذف." : "The export contains only selected conversations and never includes API keys, passwords, Arweave keys, Supabase settings, or write/delete permissions."}</p>
      <Button onClick={exportFiles}><UploadCloud className="size-4" />{ar ? "تنزيل ملفات MCP" : "Download MCP files"}</Button>
    </div>
  </SurfaceCard>;
}

export function SettingsShell({ apiKey, provider, onProviderChange, baseUrl, onBaseUrlChange, modelName, onModelNameChange, connectionStatus, plan, onPlanChange, semantic, onToggleSemantic, onApiKeyChange, onValidate, onClearKey, onClearAnalytics, conversations }: Props) {
  const ar = useLocale().locale === "ar";
  /**
   * The three ways to get a reply, in the user's language.
   *
   * Labels and hints are plain strings rather than `translations` keys: this file
   * already carries its copy inline in both languages, and one more source would
   * be a second place to look for the same sentence.
   */
  const plans = [
    {
      id: "free" as const,
      icon: Sparkles,
      label: ar ? "10 رسائل مجانية يوميًا" : "10 free messages a day",
      hint: ar ? "بلا إعداد · تتجدد منتصف الليل UTC" : "No setup · renews at midnight UTC",
    },
    {
      id: "byok" as const,
      icon: KeyRound,
      label: ar ? "مفتاحي الخاص (BYOK)" : "My own key (BYOK)",
      hint: ar ? "بلا حدّ من جانبنا · تدفع لمزودك" : "No limit from us · you pay your provider",
    },
    {
      id: "local" as const,
      icon: Laptop,
      label: ar ? "نموذج محلي على جهازك" : "A local model on this device",
      hint: ar ? "بلا إنترنت · بلا مفتاح · يحتاج Ollama" : "Offline · no key · needs Ollama",
    },
  ];
  const [section, setSection] = useState("ai");
  const [advanced, setAdvanced] = useState(false);
  const [validating, setValidating] = useState(false);
  const validate = async () => { setValidating(true); await onValidate(); setValidating(false); };
  const status = connectionStatus === "connected" ? "success" : connectionStatus === "checking" ? "active" : connectionStatus === "invalid" ? "error" : "neutral";
  const sections = ar ? [{ id: "ai", label: "مزودو الذكاء الاصطناعي", summary: "إدارة الاتصال" }, { id: "memory", label: "الذاكرة", summary: "تفضيلات العرض" }, { id: "backup", label: "النسخ والاستيراد", summary: "احتفظ بنسخة من كل شيء" }, { id: "privacy", label: "الخصوصية", summary: "حدود البيانات" }, { id: "mcp", label: "تصدير MCP", summary: "مشاركة محلية للقراءة فقط" }] : [{ id: "ai", label: "AI providers", summary: "Connection management" }, { id: "memory", label: "Memory", summary: "Presentation preferences" }, { id: "backup", label: "Export & import", summary: "Keep a copy of everything" }, { id: "privacy", label: "Privacy", summary: "Data boundaries" }, { id: "mcp", label: "MCP export", summary: "Local read-only sharing" }];
  return <main className="min-h-0 flex-1 overflow-y-auto p-4 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8 sm:pt-8"><div className="mx-auto max-w-6xl space-y-6">
    <PageHeader eyebrow={ar ? "التفضيلات" : "Preferences"} title={ar ? "الإعدادات" : "Settings"} description={ar ? "اضبط PermaMind دون تغيير طريقة عمل محادثاتك أو ذاكرتك أو نسخك الاحتياطية." : "Configure PermaMind without changing how your conversations, memory, or backups work."} />
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      {/* Horizontal scroller below `lg` instead of a full-width stack: five
          stacked rows pushed the actual settings card a full screen down on a
          phone. `min-w-0` on the scroll container stops it widening the grid. */}
      <nav aria-label={ar ? "أقسام الإعدادات" : "Settings sections"} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:px-0 lg:pb-0">{sections.map((item) => <button key={item.id} type="button" onClick={() => setSection(item.id)} className={`w-auto shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-start text-sm lg:w-full lg:whitespace-normal ${section === item.id ? "bg-secondary font-medium" : "hover:bg-muted"}`} aria-current={section === item.id ? "page" : undefined}><span>{item.label}</span><span className="mt-0.5 hidden text-xs text-muted-foreground lg:block">{item.summary}</span></button>)}<button type="button" onClick={() => setAdvanced(!advanced)} className="flex w-auto shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-3 py-2 text-start text-sm hover:bg-muted lg:w-full lg:whitespace-normal" aria-expanded={advanced}>{ar ? "متقدم" : "Advanced"} <ChevronDown className={`size-4 transition-transform ${advanced ? "rotate-180" : ""}`} /></button></nav>
      <div className="space-y-4">
        {section === "ai" && (
          <SurfaceCard
            title={ar ? "كيف تريد استخدام PermaMind؟" : "How do you want to use PermaMind?"}
            description={
              ar
                ? "اختر طريقة واحدة للحصول على الردود. يمكنك تغييرها في أي وقت."
                : "Pick how replies are produced. You can change this any time."
            }
          >
            {/*
              The choice, stated once and in one place.
              It used to be implied: pasting a key switched the app to BYOK, and
              the only way back to the free allowance was to clear the key. A user
              who had simply run out of free messages had no idea the allowance was
              a choice at all, because nothing on screen said so.
            */}
            <div
              role="radiogroup"
              aria-label={ar ? "طريقة استخدام الردود" : "How replies are produced"}
              className="grid gap-2 sm:grid-cols-3"
            >
              {plans.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={plan === item.id}
                  onClick={() => onPlanChange(item.id)}
                  className={cn(
                    "flex min-h-11 flex-col items-start gap-1 rounded-2xl border p-3 text-start transition-colors",
                    plan === item.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <item.icon className="size-4 shrink-0" aria-hidden="true" />
                    {item.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{item.hint}</span>
                </button>
              ))}
            </div>

            {plan === "free" && (
              <p className="mt-4 rounded-lg border border-border/70 bg-muted/40 p-3 text-xs text-muted-foreground">
                {ar
                  ? "تستخدم 10 رسائل مجانية يوميًا، تتجدد منتصف الليل بتوقيت UTC. لا يلزم مفتاح. اختر مفتاحك الخاص للحصول على حد أعلى."
                  : "You get 10 free messages a day, renewing at midnight UTC. No key needed. Choose your own key for a higher limit."}
              </p>
            )}

            {plan !== "free" && (
              <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{ar ? "مزود API" : "API provider"}</p>
                  <StatusPill
                    status={status}
                    label={
                      connectionStatus === "connected"
                        ? (ar ? "متصل" : "Connected")
                        : connectionStatus === "checking"
                          ? (ar ? "جارٍ التحقق" : "Checking")
                          : connectionStatus === "invalid"
                            ? (ar ? "مفتاح غير صالح" : "Invalid key")
                            : (ar ? "غير متصل" : "Not connected")
                    }
                  />
                </div>

                {plan === "byok" ? (
                  <>
                    <select
                      className="mt-3 h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={provider}
                      onChange={(e) => onProviderChange(e.target.value as AiProvider)}
                      aria-label={ar ? "مزود الذكاء الاصطناعي" : "AI provider"}
                    >
                      <option value="openrouter">OpenRouter (all models)</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Claude / Anthropic</option>
                      <option value="google">Gemini / Google</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="qwen">Qwen</option>
                      <option value="kimi">Kimi / Moonshot</option>
                      <option value="grok">Grok / xAI</option>
                      <option value="nanogpt">NanoGPT</option>
                      <option value="eden">Eden AI</option>
                      <option value="orcarouter">OrcaRouter</option>
                      <option value="unorouter">UnoRouter</option>
                      <option value="llm7">LLM7</option>
                      <option value="huggingface">Hugging Face</option>
                      <option value="meta">Meta</option>
                    </select>

                    <label className="mt-3 block text-xs font-medium text-muted-foreground">
                      {ar ? "اسم النموذج (اختياري)" : "Model name (optional)"}
                      <Input
                        className="mt-1"
                        value={modelName}
                        onChange={(e) => onModelNameChange(e.target.value)}
                        placeholder={provider === "openai" ? "gpt-4o-mini" : provider === "anthropic" ? "claude-haiku-latest" : "model id"}
                        aria-label={ar ? "اسم النموذج" : "Model name"}
                      />
                    </label>

                    <Input
                      className="mt-3"
                      type="password"
                      value={apiKey}
                      onChange={(e) => onApiKeyChange(e.target.value)}
                      autoComplete="off"
                      placeholder={`${provider === "openrouter" ? "OpenRouter" : provider} API key`}
                      aria-label={ar ? "مفتاح المزود" : "AI provider API key"}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {ar
                        ? "مفتاحك يبقى في جلسة المتصفح هذه فقط، ويُمسح عند إغلاقه، ولا يُحفظ على خوادمنا."
                        : "Your key stays in this browser session only, is cleared when you close the browser, and is never stored on our servers."}
                    </p>

                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        onClick={validate}
                        disabled={
                          !apiKey.trim() ||
                          (provider === "custom" && (!baseUrl.trim() || !modelName.trim())) ||
                          validating
                        }
                      >
                        {validating ? (ar ? "جارٍ التحقق…" : "Validating…") : ar ? "تحقّق" : "Validate"}
                      </Button>
                      {apiKey && (
                        <Button size="sm" variant="outline" onClick={onClearKey}>
                          {ar ? "مسح" : "Clear"}
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                      {ar
                        ? "النموذج المحلي يعمل على جهازك عبر Ollama بلا مفتاح. بحث الويب والمزامنة السحابية يبقيان متوقفين حتى لا يغادر السياق هذا الجهاز."
                        : "The local model runs on this device through Ollama with no key. Web search and cloud sync stay off so context does not leave this device."}
                    </p>
                    <label className="mt-3 block text-xs font-medium text-muted-foreground">
                      {ar ? "اسم الموديل في Ollama" : "Model name in Ollama"}
                      <Input
                        className="mt-1"
                        value={modelName}
                        onChange={(e) => onModelNameChange(e.target.value)}
                        placeholder="qwen2.5:3b"
                        aria-label={ar ? "اسم الموديل" : "Model name"}
                      />
                    </label>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {ar
                        ? "حمّله مرة واحدة بـ `ollama pull qwen2.5:3b` (‏≈1.9 GB). يجب أن يعمل التطبيق على نفس جهاز Ollama."
                        : "Pull it once with `ollama pull qwen2.5:3b` (≈1.9 GB). The app must run on the same machine as Ollama."}
                    </p>

                    {/*
                      A local plan is only sendable with a name: the server
                      rejects a keyless request without `x-ai-model`. Saying so
                      here is the difference between a clear message and a 500.
                    */}
                    {!modelName.trim() && (
                      <p className="mt-2 text-xs text-destructive">
                        {ar
                          ? "أدخل اسم موديل مثبَّتًا في Ollama أولًا."
                          : "Enter a model that Ollama has pulled first."}
                      </p>
                    )}

                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={validate}
                        disabled={!modelName.trim() || validating}
                        className="min-h-11"
                      >
                        {validating
                          ? (ar ? "جارٍ الفحص…" : "Checking…")
                          : ar
                            ? "فحص الاتصال"
                            : "Check connection"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </SurfaceCard>
        )}
        {/* Option B: the key kept on our servers so a room can answer without the host.
            Sits with the provider settings because it is a statement about that key rather than
            a separate account feature. */}
        {section === "ai" && <RoomKeyPanel />}
        {section === "memory" && (
          <SurfaceCard
            title={ar ? "الذاكرة" : "Memory"}
            description={
              ar
                ? "تحكّم في كيفية عرض السياق المحفوظ مع إبقاء سلوك الاسترجاع دون تغيير."
                : "Control how remembered context is presented while keeping retrieval behavior unchanged."
            }
          >
            <Row
              label={ar ? "ظهور الذاكرة" : "Memory visibility"}
              description={
                ar
                  ? "تبقى مؤشرات الذاكرة وشروحاتها متاحة في المحادثة والذاكرة."
                  : "Memory indicators and explanations remain available in Chat and Memory."
              }
            >
              <StatusPill status="protected" label={ar ? "السلوك الحالي" : "Existing behavior"} />
            </Row>

            {/*
              The semantic model.
              It is the only feature that downloads a model, so the copy says what
              it costs (once, ~150 MB) and what it buys (recall by meaning rather
              than by spelling), and the switch is never flipped on the user's
              behalf.
            */}
            <div className="pt-4">
              <p className="text-label">
                {ar ? "الذاكرة الدلالية (على جهازك)" : "Semantic memory (on this device)"}
              </p>
              <p className="mt-1 text-caption">
                {ar
                  ? "تسمح بالعثور على المحادثات بالمعنى لا بالتشابه اللفظي فقط. يعمل النموذج داخل متصفحك، ولا يخرج أي نص من جهازك."
                  : "Finds conversations by meaning, not only by shared words. The model runs inside your browser and no text leaves this device."}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={semantic.enabled ? "outline" : "default"}
                  className="min-h-11"
                  disabled={semantic.status === "loading"}
                  onClick={() => onToggleSemantic(!semantic.enabled)}
                >
                  {semantic.status === "loading"
                    ? ar
                      ? `جارٍ التنزيل… ${Math.round(semantic.progress * 100)}%`
                      : `Downloading… ${Math.round(semantic.progress * 100)}%`
                    : semantic.enabled
                      ? ar
                        ? "إيقاف"
                        : "Turn off"
                      : ar
                        ? "تشغيل وتنزيل النموذج"
                        : "Enable and download the model"}
                </Button>

                {semantic.status === "error" && (
                  <span className="text-xs text-destructive">
                    {ar ? "تعذّر تنزيل النموذج. ستبقى الذاكرة بالكلمات المحلية." : "The model could not be downloaded. Local keyword memory is still on."}
                  </span>
                )}
                {semantic.status === "ready" && (
                  <span className="text-xs text-muted-foreground">
                    {ar ? "النموذج جاهز" : "Model ready"}
                  </span>
                )}
              </div>

              <p className="mt-2 text-[11px] text-muted-foreground">
                {ar
                  ? "تنزيل لمرة واحدة بحجم ~225 MB (197 MB للأوزان + ملفات اللغة)، ثم يعمل دون إنترنت. يحتاج Chrome أو Edge أو Safari حديثًا."
                  : "A one-time ~225 MB download (197 MB of weights plus the tokenizer), then it runs offline. Needs a recent Chrome, Edge, or Safari."}
              </p>
            </div>
          </SurfaceCard>
        )}
        {section === "backup" && <FullExportPanel />}
        {section === "privacy" && <SurfaceCard title={ar ? "الخصوصية" : "Privacy"} description={ar ? "افهم أين تعيش بياناتك ومعنى النسخ الاحتياطي." : "Understand where your data lives and what backup means."}><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-md border p-4"><p className="text-label">{ar ? "تخزين محلي" : "Local storage"}</p><p className="mt-2 text-caption">{ar ? "تبقى المحادثات متاحة في تخزين المتصفح/الجهاز." : "Conversations remain available in your browser/device storage."}</p></div><div className="rounded-md border p-4"><LockKeyhole className="size-4" /><p className="mt-2 text-label">{ar ? "نسخ احتياطي مشفر" : "Encrypted backup"}</p><p className="mt-2 text-caption">{ar ? "تُشفَّر النسخ الاحتياطية قبل الرفع وتعتمد على عبارة المرور." : "Backups are encrypted before upload and depend on your passphrase."}</p></div><div className="rounded-md border p-4"><UploadCloud className="size-4" /><p className="text-label">{ar ? "تخزين دائم" : "Permanent storage"}</p><p className="mt-2 text-caption">{ar ? "قد تكون البيانات الدائمة المرفوعة غير قابلة للعكس؛ مركز النسخ الاحتياطي يشرح العواقب." : "Uploaded permanent data may be irreversible; Backup Center explains consequences."}</p></div></div></SurfaceCard>}
        {section === "mcp" && <McpExportPanel conversations={conversations} />}
        {advanced && <SurfaceCard title={ar ? "خادم مخصص متقدم" : "Advanced custom server"} description={ar ? "تُرسل محادثتك ومفتاحك فقط إلى عنوان HTTPS عام بعد فحص DNS. العناوين الخاصة والتحويلات غير العامة تُرفض." : "Your conversation and key are sent only to a public HTTPS address after its DNS records are checked. Private addresses and non-public redirects are refused."}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={provider === "custom"} onChange={(event) => onProviderChange(event.target.checked ? "custom" : "openrouter")} />{ar ? "استخدام خادم متوافق مع OpenAI" : "Use an OpenAI-compatible server"}</label>{provider === "custom" && <Input className="mt-3" value={baseUrl} onChange={(e) => onBaseUrlChange(e.target.value)} placeholder="https://your-public-server.example/v1" aria-label="Custom base URL" />}</SurfaceCard>}
        {advanced && <SurfaceCard title={ar ? "متقدم" : "Advanced"} description={ar ? "هذه الإجراءات قد تؤثر على تجربتك المحلية. راجع النتيجة قبل المتابعة." : "These actions can affect your local experience. Review the consequence before continuing."}><Row label={ar ? "التشخيصات والتحليلات" : "Diagnostics and analytics"} description={ar ? "استخدم أدوات التحليلات الموجودة وسلوك التشخيص المخزن." : "Use the existing analytics controls and stored diagnostics behavior."}><Button size="sm" variant="outline" onClick={onClearAnalytics}>{ar ? "مسح التحليلات" : "Clear analytics"}</Button></Row><Row label={ar ? "إعادة تعيين الترحيب" : "Reset onboarding"} description={ar ? "إظهار شاشات الترحيب مجدداً عند التحميل التالي." : "Show the first-run onboarding again on the next load."}><Button size="sm" variant="outline" onClick={() => { resetFirstRun(); window.location.reload(); }}><RotateCcw className="size-4" />{ar ? "إعادة تعيين الترحيب" : "Reset onboarding"}</Button></Row></SurfaceCard>}
      </div>
    </div>
  </div></main>;
}
