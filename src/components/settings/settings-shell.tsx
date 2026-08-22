"use client";

import { Check, ChevronDown, Copy, LockKeyhole, RotateCcw, UploadCloud } from "lucide-react";
import { useState } from "react";
import type { ConnectionStatus } from "@/hooks/use-api-settings";
import type { AiProvider } from "@/lib/settings/api-key-storage";
import { resetFirstRun } from "@/lib/settings/first-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StatusPill } from "@/components/ui/status-pill";
import { useLocale } from "@/hooks/use-locale";
import type { Conversation } from "@/types/chat";
import { buildMcpExport, type McpContentLevel } from "@/lib/mcp/export";

type Props = {
  apiKey: string; provider: AiProvider; onProviderChange: (provider: AiProvider) => void; baseUrl: string; onBaseUrlChange: (value: string) => void; modelName: string; onModelNameChange: (value: string) => void; connectionStatus: ConnectionStatus;
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
  const copyMcpUrl = async () => { await navigator.clipboard.writeText(mcpUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  const copyCodexConfig = async () => {
    const config = JSON.stringify({ mcpServers: { permamind: { url: mcpUrl, headers: { Authorization: "Bearer YOUR_PERMAMIND_ACCESS_TOKEN" } } } }, null, 2);
    await navigator.clipboard.writeText(config);
    setCopiedConfig(true);
    window.setTimeout(() => setCopiedConfig(false), 1800);
  };
  const download = (name: string, value: unknown) => { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); };
  const exportFiles = () => { const result = buildMcpExport(conversations, { conversationIds: selected, contentLevel: level, allowSearch }); download("permamind-data.json", result.data); download("mcp-policy.json", result.policy); };
  return <SurfaceCard title={ar ? "MCP وأدوات الذكاء الاصطناعي الخارجية" : "MCP & External AI Tools"} description={ar ? "اربط Cursor أو Claude بملخصات PermaMind المسموح بها، أو أنشئ تصديراً محلياً للقراءة فقط." : "Connect Cursor or Claude to approved PermaMind summaries, or create a local read-only export."}>
    <div className="space-y-4">
      <div className="rounded-md border border-primary/30 bg-primary/5 p-4 text-sm leading-relaxed">
        <p className="font-semibold">{ar ? "اتصال MCP السحابي" : "Cloud MCP connection"}</p>
        <p className="mt-1 text-muted-foreground">{ar ? "استخدم هذه النقطة للقراءة فقط مع Cursor أو Claude أو OpenAI Codex. تُكشف فقط الملخصات المسموح بها؛ ولا تُعاد المحادثات الكاملة أو النسخ الاحتياطية المشفرة أو المفاتيح الخاصة أبداً." : "Use this read-only endpoint with Cursor, Claude, or OpenAI Codex. Only summaries marked as allowed are exposed; full conversations, encrypted backups, and private keys are never returned."}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input readOnly value={mcpUrl} aria-label="MCP server URL" className="font-mono text-xs" /><Button type="button" size="sm" variant="outline" onClick={() => void copyMcpUrl()}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? (ar ? "تم النسخ" : "Copied") : (ar ? "نسخ الرابط" : "Copy URL")}</Button></div>
        <p className="mt-2 text-xs text-muted-foreground">{ar ? "أضف الرابط كخادم MCP بعيد وصادق باستخدام رمز Bearer من PermaMind. لا تلصق رمز الجلسة أبداً في ملف عام ولا تشاركه مع أحد." : "Add the URL as a remote MCP server and authenticate with a PermaMind Bearer token. Never paste a session token into a public file or share it with anyone."}</p>
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

export function SettingsShell({ apiKey, provider, onProviderChange, baseUrl, onBaseUrlChange, modelName, onModelNameChange, connectionStatus, onApiKeyChange, onValidate, onClearKey, onClearAnalytics, conversations }: Props) {
  const ar = useLocale().locale === "ar";
  const [section, setSection] = useState("ai");
  const [advanced, setAdvanced] = useState(false);
  const [validating, setValidating] = useState(false);
  const validate = async () => { setValidating(true); await onValidate(); setValidating(false); };
  const status = connectionStatus === "connected" ? "success" : connectionStatus === "checking" ? "active" : connectionStatus === "invalid" ? "error" : "neutral";
  const sections = ar ? [{ id: "ai", label: "مزودو الذكاء الاصطناعي", summary: "إدارة الاتصال" }, { id: "memory", label: "الذاكرة", summary: "تفضيلات العرض" }, { id: "privacy", label: "الخصوصية", summary: "حدود البيانات" }, { id: "mcp", label: "تصدير MCP", summary: "مشاركة محلية للقراءة فقط" }] : [{ id: "ai", label: "AI providers", summary: "Connection management" }, { id: "memory", label: "Memory", summary: "Presentation preferences" }, { id: "privacy", label: "Privacy", summary: "Data boundaries" }, { id: "mcp", label: "MCP export", summary: "Local read-only sharing" }];
  return <main className="min-h-0 flex-1 overflow-y-auto p-4 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8 sm:pt-8"><div className="mx-auto max-w-6xl space-y-6">
    <PageHeader eyebrow={ar ? "التفضيلات" : "Preferences"} title={ar ? "الإعدادات" : "Settings"} description={ar ? "اضبط PermaMind دون تغيير طريقة عمل محادثاتك أو ذاكرتك أو نسخك الاحتياطية." : "Configure PermaMind without changing how your conversations, memory, or backups work."} />
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav aria-label={ar ? "أقسام الإعدادات" : "Settings sections"} className="space-y-1">{sections.map((item) => <button key={item.id} type="button" onClick={() => setSection(item.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${section === item.id ? "bg-secondary font-medium" : "hover:bg-muted"}`} aria-current={section === item.id ? "page" : undefined}><span>{item.label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{item.summary}</span></button>)}<button type="button" onClick={() => setAdvanced(!advanced)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted" aria-expanded={advanced}>{ar ? "متقدم" : "Advanced"} <ChevronDown className={`size-4 transition-transform ${advanced ? "rotate-180" : ""}`} /></button></nav>
      <div className="space-y-4">
        {section === "ai" && <SurfaceCard title={ar ? "مزودو الذكاء الاصطناعي" : "AI providers"} description={ar ? "استخدم OpenRouter أو مزواً مباشراً أو خادماً خاصاً متوافقاً مع OpenAI." : "Use OpenRouter, a direct provider, or your own Kaggle/ngrok OpenAI-compatible server."}><div className="rounded-lg border border-primary/40 bg-primary/5 p-4"><div className="flex items-center justify-between"><p className="font-medium">{ar ? "مزود API" : "API provider"}</p><StatusPill status={status} label={connectionStatus === "connected" ? (ar ? "متصل" : "Connected") : connectionStatus === "checking" ? (ar ? "جارٍ التحقق" : "Checking") : connectionStatus === "invalid" ? (ar ? "مفتاح غير صالح" : "Invalid key") : (ar ? "غير متصل" : "Not connected")} /></div><select className="mt-3 h-10 w-full rounded-md border bg-background px-3 text-sm" value={provider} onChange={(e) => onProviderChange(e.target.value as AiProvider)} aria-label="AI provider"><option value="openrouter">OpenRouter (all models)</option><option value="openai">OpenAI</option><option value="anthropic">Claude / Anthropic</option><option value="google">Gemini / Google</option><option value="deepseek">DeepSeek</option><option value="qwen">Qwen</option><option value="kimi">Kimi / Moonshot</option><option value="grok">Grok / xAI</option><option value="meta">Meta</option><option value="custom">{ar ? "مخصص / Kaggle (ngrok)" : "Custom / Kaggle (ngrok)"}</option></select>{provider === "custom" && <Input className="mt-3" value={baseUrl} onChange={(e) => onBaseUrlChange(e.target.value)} placeholder="https://your-tunnel.ngrok-free.app/v1" aria-label="Custom base URL" />}<label className="mt-3 block text-xs font-medium text-muted-foreground">{ar ? "اسم النموذج (اختياري)" : "Model name (optional)"}<Input className="mt-1" value={modelName} onChange={(e) => onModelNameChange(e.target.value)} placeholder={provider === "custom" ? "Hugging Face model name" : provider === "openai" ? "gpt-4o-mini" : provider === "anthropic" ? "claude-haiku-latest" : provider === "google" ? "gemini-2.0-flash" : provider === "openrouter" ? "anthropic/claude-haiku-latest" : "model id"} aria-label="Model name" /></label><Input className="mt-3" type="password" value={apiKey} onChange={(e) => onApiKeyChange(e.target.value)} autoComplete="off" placeholder={`${provider === "openrouter" ? "OpenRouter" : provider} API key`} aria-label="AI provider API key" /><p className="mt-2 text-xs text-muted-foreground">{ar ? "مفاتيح API غير قابلة للتبادل. يمكنك تحديد معرّف النموذج المطلوب اختيارياً — يتجاوز النموذج الافتراضي للتطبيق. للمخصص/Kaggle أدخل رابط ngrok الحالي واسم النموذج. يُحفظ المفتاح في هذه الجلسة فقط ويُمسح عند إغلاق المتصفح." : "API keys are not interchangeable. Optionally set the exact model ID you want to use — it overrides the app default. For Custom/Kaggle, enter the current HTTPS ngrok URL and model name. Your key is stored for this browser session only and is cleared when the browser closes."}</p><div className="mt-3 flex gap-2"><Button size="sm" onClick={validate} disabled={!apiKey.trim() || (provider === "custom" && (!baseUrl.trim() || !modelName.trim())) || validating}>{validating ? "Validating…" : "Validate"}</Button>{apiKey && <Button size="sm" variant="outline" onClick={onClearKey}>Clear</Button>}</div></div></SurfaceCard>}
        {section === "memory" && <SurfaceCard title={ar ? "الذاكرة" : "Memory"} description={ar ? "تحكّم في كيفية عرض السياق المحفوظ مع إبقاء سلوك الاسترجاع دون تغيير." : "Control how remembered context is presented while keeping retrieval behavior unchanged."}><Row label={ar ? "ظهور الذاكرة" : "Memory visibility"} description={ar ? "تبقى مؤشرات الذاكرة وشروحاتها متاحة في المحادثة والذاكرة." : "Memory indicators and explanations remain available in Chat and Memory."}><StatusPill status="protected" label={ar ? "السلوك الحالي" : "Existing behavior"} /></Row><p className="pt-4 text-caption">{ar ? "البحث والاسترجاع والمصدر وإعدادات العرض تبقى مملوكة للتجارب الحالية دون تغيير." : "Search, recall, provenance, and memory presentation controls remain owned by their existing experiences."}</p></SurfaceCard>}
        {section === "privacy" && <SurfaceCard title={ar ? "الخصوصية" : "Privacy"} description={ar ? "افهم أين تعيش بياناتك ومعنى النسخ الاحتياطي." : "Understand where your data lives and what backup means."}><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-md border p-4"><p className="text-label">{ar ? "تخزين محلي" : "Local storage"}</p><p className="mt-2 text-caption">{ar ? "تبقى المحادثات متاحة في تخزين المتصفح/الجهاز." : "Conversations remain available in your browser/device storage."}</p></div><div className="rounded-md border p-4"><LockKeyhole className="size-4" /><p className="mt-2 text-label">{ar ? "نسخ احتياطي مشفر" : "Encrypted backup"}</p><p className="mt-2 text-caption">{ar ? "تُشفَّر النسخ الاحتياطية قبل الرفع وتعتمد على عبارة المرور." : "Backups are encrypted before upload and depend on your passphrase."}</p></div><div className="rounded-md border p-4"><UploadCloud className="size-4" /><p className="text-label">{ar ? "تخزين دائم" : "Permanent storage"}</p><p className="mt-2 text-caption">{ar ? "قد تكون البيانات الدائمة المرفوعة غير قابلة للعكس؛ مركز النسخ الاحتياطي يشرح العواقب." : "Uploaded permanent data may be irreversible; Backup Center explains consequences."}</p></div></div></SurfaceCard>}
        {section === "mcp" && <McpExportPanel conversations={conversations} />}
        {advanced && <SurfaceCard title={ar ? "متقدم" : "Advanced"} description={ar ? "هذه الإجراءات قد تؤثر على تجربتك المحلية. راجع النتيجة قبل المتابعة." : "These actions can affect your local experience. Review the consequence before continuing."}><Row label={ar ? "التشخيصات والتحليلات" : "Diagnostics and analytics"} description={ar ? "استخدم أدوات التحليلات الموجودة وسلوك التشخيص المخزن." : "Use the existing analytics controls and stored diagnostics behavior."}><Button size="sm" variant="outline" onClick={onClearAnalytics}>{ar ? "مسح التحليلات" : "Clear analytics"}</Button></Row><Row label={ar ? "إعادة تعيين الترحيب" : "Reset onboarding"} description={ar ? "إظهار شاشات الترحيب مجدداً عند التحميل التالي." : "Show the first-run onboarding again on the next load."}><Button size="sm" variant="outline" onClick={() => { resetFirstRun(); window.location.reload(); }}><RotateCcw className="size-4" />{ar ? "إعادة تعيين الترحيب" : "Reset onboarding"}</Button></Row></SurfaceCard>}
      </div>
    </div>
  </div></main>;
}