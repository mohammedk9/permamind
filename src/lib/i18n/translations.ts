export type Locale = "en" | "ar";

export const translations = {
  en: {
    // Header
    signIn: "Sign In",
    signUp: "Sign Up",
    languageToggle: "AR",

    // Hero
    heroBadge: "Your memory. Any model. Permanently yours.",
    heroTitle: "One memory.",
    heroTitleHighlight: "Every model.",
    heroTitleEnd: "Yours forever.",
    heroDescription:
      "Use OpenAI, Claude, Gemini, DeepSeek, or another provider. PermaMind keeps the context, recalls it next time, and — only if you choose — encrypts it on your device for permanent storage on Arweave.",
    providerRail: "Works with the models you already use",
    heroCta: "Create a free account",
    heroSecondary: "See how it works",
    heroTrust: "Your encryption passphrase never leaves your device. Even we can't read your backups.",
    proofLabel: "Context, brought back",
    proofStatus: "PermaMind memory recall",
    proofQuestion: "What did we decide about the Atlas launch last month?",
    proofAnswer: "You chose a staged launch: private beta first, then a public release after the Arabic review.",
    proofSource: "From 3 earlier conversations · View sources",
    stageModel: "Any model",
    stageModelValue: "OpenAI, Claude, Gemini, DeepSeek",
    stageMemory: "Your memory",
    stageMemoryValue: "Context recalled locally",
    stageVault: "Your vault",
    stageVaultValue: "Encrypted, then Arweave",
    stageEncrypted: "Encrypted before upload",
    stageCipher: "AES-256-GCM · on your device",
    stagePermanent: "Permanent · cannot be deleted",
    compareTitle: "Chat apps forget. PermaMind keeps ownership.",
    compareDescription:
      "The model can change. The memory stays yours — on your device, and on Arweave only when you decide.",
    compare: [
      {
        title: "Switch models, keep context",
        description: "The same memory follows you across OpenAI, Claude, Gemini, DeepSeek, and the rest.",
      },
      {
        title: "Keys never leave the device",
        description: "Your API key and encryption passphrase stay in the browser. We cannot read the backup.",
      },
      {
        title: "Arweave makes it permanent",
        description: "After confirmation, the platform cannot delete it. Ownership outlives the app.",
      },
    ],
    trustItems: [
      "Local by default",
      "Bring your own AI key",
      "Context recalled next time",
      "Optional permanent backup",
    ],

    // Free storage gift
    freeTierTitle: "Every new account receives a free permanent Arweave storage gift — no credit card required.",
    freeTierDescription:
      "Use it to preserve the conversations that matter. You can expand it later with other payment options, including ETH and SOL.",
    freeTierNote: "The gift is added to your account after signup.",

    // Features
    featuresTitle: "What you actually get",
    featuresDescription:
      "A memory you can use today, move when you want, and preserve permanently only if you choose to.",
    features: [
      {
        title: "Context that comes back",
        description:
          "PermaMind extracts what matters and brings it into the next conversation, in Arabic or English.",
        icon: "brain",
      },
      {
        title: "Memory you can move",
        description:
          "Search it, export it, or carry it to another AI provider. Share only the summaries you approve.",
        icon: "search",
      },
      {
        title: "A backup you choose",
        description:
          "Encrypted on your device before upload. After it is confirmed on Arweave, it is permanent and cannot be deleted.",
        icon: "shield",
      },
      {
        title: "A decision ledger inside memory",
        description:
          "Open Memory to review decisions. A newer one stays beside the older one, with its source and date. Pin it, correct it, or write a short note without replacing the old decision.",
        icon: "search",
      },
      {
        title: "A model that stays on this device",
        description:
          "Optional Ollama at 127.0.0.1 port 11434, with no API key. Web search stays off. If a decision must remain on this device, keep cloud sync off too.",
        icon: "globe",
      },
      {
        title: "Rooms that read the room, and nothing else",
        description:
          "Brainstorm with people and your own model. Guests join with a link and a code, no account. The model is given the room transcript only, never your private conversations or memory. The room ends when the host says so, and is deleted with it.",
        icon: "users",
      },
    ],

    // MCP
    mcpTitle: "Your approved memory, wherever you work",
    mcpDescription:
      "Connect PermaMind to Cursor, Claude, OpenAI Codex, or another MCP client through a read-only interface. You choose which summaries can be shared; full conversations, encrypted backups, and private keys stay out of reach.",
    mcpPoints: [
      "Read-only access to approved summaries and decisions",
      "Search a memory, open one item, or list decisions with their date and source",
      "Saving through the agent is rejected and recorded",
      "Privacy warning before every export or connection",
    ],
    mcpCta: "Learn about MCP in Settings",
    mcpCardTitle: "Read-only memory bridge",
    mcpCardSubtitle: "PermaMind → Cursor / Claude / Codex",
    mcpCardEndpoint: "Your MCP address appears in Settings after you sign in.",
    mcpCardConnect: "Connect after signing in and explicitly approve the summaries you want to share.",

    // How it works
    howItWorksTitle: "How it works",
    howItWorksDescription:
      "Four steps from an ordinary conversation to a memory that is yours for good.",
    howEyebrow: "Chat. Recall. Keep.",
    howPreviewHint: "Pick a step to preview it.",
    howPreview: {
      chatUser: "What did we decide about the Atlas launch last month?",
      chatAssistant:
        "A staged launch: private beta first, then public after the Arabic review.",
      chatNote: "Your API key and passphrase stay on this device.",
      extractTitle: "What PermaMind kept",
      extractItems: [
        "Launch: staged, private beta before public",
        "Owner: you — not the model provider",
        "Language: Arabic and English",
      ],
      extractNote: "Stored beside your chat, on this device.",
      recallLabel: "Context recalled",
      vaultNote: "Only after you confirm, and it can never be deleted.",
    },
    steps: [
      {
        title: "Chat naturally",
        description: "Talk to the provider you already use. Nothing is uploaded by default.",
      },
      {
        title: "Keep the context",
        description: "PermaMind lifts out the decisions, names, and details worth keeping.",
      },
      {
        title: "Pick up where you left off",
        description: "The next chat starts with the relevant context, not from zero.",
      },
      {
        title: "Preserve what matters",
        description: "You choose. It is encrypted here, then stored permanently on Arweave.",
      },
    ],

    // Security strip (numbers come from src/lib/arweave/constants.ts)
    securityTitle: "Security you can verify",
    securityCipher: "Encrypted before any upload",
    securityKdf: "iterations",
    storageNote: (freeMb: string) => `max per upload · ${freeMb} free`,

    // Internet Search
    searchTitle: "Internet Search",
    searchDescription:
      "When your memory isn't enough, PermaMind can search the live web through Exa to give you a more complete answer.",
    searchBadge: "Coming soon · Beta",

    // CTA
    ctaTitle: "Give your next conversation a head start.",
    ctaDescription:
      "Create your memory, use the AI provider you prefer, and come back with the context already there.",
    ctaButton: "Create a free account",

    // Footer
    footerDescription: "AI memory that stays with you — chat, recall, and carry your context.",
    footerRights: "All rights reserved.",
    footerPrivacy: "Privacy Policy",
    footerTerms: "Terms of Use",
    footerHelp: "Help",
    footerContact: "Contact us on X",
    helpTitle: "Help",
    helpDescription: "Need help or want to share feedback? Contact us on X and we will be happy to help.",
    privacyTitle: "Privacy Policy",
    privacyDescription: "PermaMind stores conversations and settings locally in your browser by default. You control what is encrypted and uploaded to Arweave. Your encryption passphrase never reaches the server or AI provider. Arweave backups are permanent and cannot be deleted, so review your storage policy before uploading.",
    privacySections: [
      {
        title: "What we store",
        body: "Conversations and settings stay in your browser by default. PermaMind does not sell, rent, or use your conversations for marketing.",
      },
      {
        title: "Memory you control",
        body: "You can export and restore your memory and switch AI providers. Your encryption passphrase stays on your device and is not sent to the server or the AI provider.",
      },
      {
        title: "What is sent to the AI provider",
        body: "Only the messages and context needed to generate a reply are sent. Review what you share before connecting MCP clients such as Claude, Cursor, or Codex.",
      },
      {
        title: "Optional backups",
        body: "Optional backups are encrypted locally before upload. Arweave uploads are permanent and cannot be deleted after confirmation.",
      },
    ],
    termsTitle: "Terms of Use",
    termsDescription: "Use PermaMind lawfully and responsibly. AI responses may be inaccurate, so review important information and do not treat the service as professional legal, medical, financial, or religious advice. You are responsible for the content you enter and for keeping your keys secure.",
    termsSections: [
      {
        title: "Acceptable use",
        body: "Use PermaMind lawfully and responsibly. Do not use it to harm others, violate rights, distribute illegal content, or disrupt the service.",
      },
      {
        title: "AI responses",
        body: "AI answers can be inaccurate. Review important information and do not treat the service as legal, medical, financial, or religious advice.",
      },
      {
        title: "Your content and keys",
        body: "You are responsible for the content you enter and for protecting your API keys and encryption passphrase.",
      },
      {
        title: "Permanent storage",
        body: "Arweave backups are optional. Once uploaded, they are permanent and cannot be undone. Confirm this before enabling a permanent backup.",
      },
    ],
    legalBack: "Back to home",
    legalUpdated: "Last updated",
    storageGuideTitle: "Choose how your data is stored",
    storageGuideDescription: "Local, cloud, and Arweave are separate. Turning one on does not change the others, and nothing is uploaded just because you choose it.",
    storageGuideBack: "Back to backup",
    storageGuideSections: [
      {
        title: "Local",
        body: "This is always on. Conversations stay on this device and are not uploaded. Clearing this browser can remove them, so export a copy if you need one.",
      },
      {
        title: "Cloud (Supabase)",
        body: "Optional and separate from Arweave. After you turn it on, choose conversations, memories, or projects. Only a selected encrypted summary is sent, and only after a separate warning and your confirmation. You can delete this cloud data later. The sync passphrase stays in memory and must be entered again on another device.",
      },
      {
        title: "Arweave",
        body: "Optional and separate from cloud storage. After you turn it on, choose which conversations a permanent backup may include. The copy is encrypted in this browser before upload. After upload it cannot be deleted. Losing the passphrase means that copy cannot be decrypted.",
      },
    ],
  },

  ar: {
    // Header
    signIn: "تسجيل الدخول",
    signUp: "إنشاء حساب",
    languageToggle: "EN",

    // Hero
    heroBadge: "ذاكرتك. أي نموذج. وتبقى ملكك.",
    heroTitle: "ذاكرة واحدة.",
    heroTitleHighlight: "لكل نموذج.",
    heroTitleEnd: "وتبقى ملكك.",
    heroDescription:
      "استخدم OpenAI أو Claude أو Gemini أو DeepSeek أو أي مزود آخر. يحتفظ PermaMind بالسياق ويعيده في المرة القادمة، وإذا اخترت ذلك يشفّره على جهازك لتخزين دائم على Arweave.",
    providerRail: "يعمل مع النماذج التي تستخدمها بالفعل",
    heroCta: "أنشئ حساباً مجانياً",
    heroSecondary: "شاهد كيف يعمل",
    heroTrust: "عبارة تشفيرك لا تغادر جهازك أبدًا. حتى نحن لا نستطيع قراءة نسخك الاحتياطية.",
    proofLabel: "سياق يعود إليك",
    proofStatus: "استرجاع ذاكرة PermaMind",
    proofQuestion: "ماذا قررنا بشأن إطلاق مشروع أطلس الشهر الماضي؟",
    proofAnswer: "اخترت إطلاقاً على مراحل: تجربة خاصة أولاً، ثم إطلاق عام بعد المراجعة العربية.",
    proofSource: "من 3 محادثات سابقة · عرض المصادر",
    stageModel: "أي نموذج",
    stageModelValue: "OpenAI وClaude وGemini وDeepSeek",
    stageMemory: "ذاكرتك",
    stageMemoryValue: "سياق يُسترجع محليًا",
    stageVault: "خزينتك",
    stageVaultValue: "تشفير ثم Arweave",
    stageEncrypted: "تُشفّر قبل الرفع",
    stageCipher: "AES-256-GCM · على جهازك",
    stagePermanent: "دائمة · لا يمكن حذفها",
    compareTitle: "تطبيقات الدردشة تنسى. PermaMind يُبقي الملكية لك.",
    compareDescription:
      "النموذج يمكن أن يتغير. الذاكرة تبقى ملكك: على جهازك، وعلى Arweave فقط عندما تقرر ذلك.",
    compare: [
      {
        title: "بدّل النموذج وأبقِ السياق",
        description: "الذاكرة نفسها تنتقل معك بين OpenAI وClaude وGemini وDeepSeek وغيرها.",
      },
      {
        title: "المفاتيح لا تغادر الجهاز",
        description: "مفتاحك وعبارة التشفير يبقيان في المتصفح. نحن لا نستطيع قراءة النسخة.",
      },
      {
        title: "Arweave يجعلها دائمة",
        description: "بعد التأكيد لا تستطيع المنصة حذفها. الملكية تبقى حتى بعد التطبيق.",
      },
    ],
    trustItems: [
      "محلي بشكل افتراضي",
      "استخدم مفتاح الذكاء الاصطناعي الخاص بك",
      "يُسترجع السياق في المرة القادمة",
      "نسخة دائمة تختارها أنت",
    ],

    // Free storage gift
    freeTierTitle: "كل حساب جديد يحصل على هدية تخزين دائم مجانية على Arweave — بدون بطاقة ائتمان.",
    freeTierDescription:
      "استخدمها لحفظ المحادثات المهمة. ويمكنك زيادة المساحة لاحقًا بخيارات دفع أخرى، منها ETH وSOL.",
    freeTierNote: "تُضاف الهدية إلى حسابك بعد إكمال التسجيل.",

    // Features
    featuresTitle: "ما الذي تحصل عليه فعلاً",
    featuresDescription:
      "ذاكرة تستخدمها اليوم، وتنقلها متى شئت، وتحفظها بشكل دائم فقط إذا اخترت ذلك.",
    features: [
      {
        title: "سياق يعود إليك",
        description:
          "يستخرج PermaMind ما يهم ويعيده في المحادثة التالية، بالعربية أو الإنجليزية.",
        icon: "brain",
      },
      {
        title: "ذاكرة يمكنك نقلها",
        description:
          "ابحث فيها، أو صدّرها، أو انقلها إلى مزود ذكاء اصطناعي آخر. وشارك فقط الملخصات التي توافق عليها.",
        icon: "search",
      },
      {
        title: "نسخة تختارها أنت",
        description:
          "تُشفّر على جهازك قبل الرفع. وبعد تأكيدها على Arweave تصبح دائمة ولا يمكن حذفها.",
        icon: "shield",
      },
      {
        title: "دفتر قرارات داخل الذاكرة",
        description:
          "افتح الذاكرة لمراجعة القرارات. القرار الأحدث يبقى بجانب الأقدم مع مصدره وتاريخه. يمكنك تثبيته أو تصحيحه أو كتابة ملاحظة قصيرة دون استبدال القرار القديم.",
        icon: "search",
      },
      {
        title: "نموذج يبقى على هذا الجهاز",
        description:
          "Ollama اختياري على العنوان المحلي 127.0.0.1 والمنفذ 11434، بلا مفتاح. بحث الويب يبقى متوقفاً. إذا كان يجب أن يبقى القرار على هذا الجهاز، أبقِ المزامنة السحابية مغلقة أيضاً.",
        icon: "globe",
      },
      {
        title: "غرف تقرأ الغرفة، ولا شيء غيرها",
        description:
          "اعصف ذهنياً مع أشخاص ومع نموذجك. ينضم الضيوف برابط ورمز، بلا حساب. النموذج يقرأ نص الغرفة فقط، لا محادثاتك الخاصة ولا ذاكرتك. تنتهي الغرفة حين يقول المضيف ذلك، وتُحذف معه.",
        icon: "users",
      },
    ],

    // MCP
    mcpTitle: "ذاكرتك التي توافق عليها، أينما تعمل",
    mcpDescription:
      "اربط PermaMind مع Cursor أو Claude أو OpenAI Codex أو أي عميل MCP عبر واجهة للقراءة فقط. أنت تحدد الملخصات التي يمكن مشاركتها، وتبقى المحادثات الكاملة والنسخ المشفرة والمفاتيح الخاصة بعيدة عن الوصول.",
    mcpPoints: [
      "وصول للقراءة فقط إلى الملخصات والقرارات التي توافق عليها",
      "ابحث في الذاكرة، أو افتح عنصراً واحداً، أو اعرض القرارات مع تاريخها ومصدرها",
      "حفظ الذاكرة عبر الوكيل مرفوض ويُسجَّل",
      "تحذير خصوصية قبل كل تصدير أو اتصال",
    ],
    mcpCta: "تعرّف على MCP في الإعدادات",
    mcpCardTitle: "جسر ذاكرة للقراءة فقط",
    mcpCardSubtitle: "PermaMind ← Cursor / Claude / Codex",
    mcpCardEndpoint: "يظهر عنوان MCP في الإعدادات بعد تسجيل الدخول.",
    mcpCardConnect: "يتم الاتصال بعد تسجيل الدخول وبموافقتك الصريحة على الملخصات التي تريد مشاركتها.",

    // How it works
    howItWorksTitle: "كيف يعمل",
    howItWorksDescription:
      "أربع خطوات تنقلك من محادثة عادية إلى ذاكرة تبقى ملكك للأبد.",
    howEyebrow: "تحدّث. استرجع. احتفظ.",
    howPreviewHint: "اختر أي خطوة لمعاينتها.",
    howPreview: {
      chatUser: "ماذا قررنا بشأن إطلاق Atlas الشهر الماضي؟",
      chatAssistant: "إطلاق تدريجي: نسخة تجريبية خاصة أولاً، ثم عامة بعد المراجعة العربية.",
      chatNote: "مفتاح الـ API وعبارة مرور التشفير تبقى على هذا الجهاز.",
      extractTitle: "ما الذي احتفظ به PermaMind",
      extractItems: [
        "الإطلاق: تدريجي، تجريبي خاص قبل العام",
        "الملكية: أنت — لا مزوّد النموذج",
        "اللغة: العربية والإنجليزية",
      ],
      extractNote: "يُحفظ بجانب محادثتك، على هذا الجهاز.",
      recallLabel: "سياق مسترجَع",
      vaultNote: "بعد تأكيدك فقط، ولا يمكن حذفه أبداً.",
    },
    steps: [
      {
        title: "تحدّث بشكل طبيعي",
        description: "تحدّث مع المزوّد الذي تستخدمه بالفعل. لا يُرفع شيء بشكل افتراضي.",
      },
      {
        title: "يُحفظ السياق",
        description: "يستخرج PermaMind القرارات والأسماء والتفاصيل التي تستحق الاحتفاظ.",
      },
      {
        title: "أكمل من حيث توقفت",
        description: "المحادثة التالية تبدأ بالسياق المناسب، لا من الصفر.",
      },
      {
        title: "احفظ ما يهم",
        description: "أنت تختار. يُشفَّر هنا، ثم يُحفظ بشكل دائم على Arweave.",
      },
    ],

    // Security strip (numbers come from src/lib/arweave/constants.ts)
    securityTitle: "أمان يمكنك التحقق منه",
    securityCipher: "تُشفَّر قبل أي رفع",
    securityKdf: "تكرار",
    storageNote: (freeMb: string) => `للرفع الواحد · ${freeMb} مجاناً`,

    // Internet Search
    searchTitle: "بحث الإنترنت",
    searchDescription:
      "عندما لا تكفي ذاكرتك، يستطيع PermaMind البحث في الويب عبر Exa ليقدم إجابة أكمل.",
    searchBadge: "قريباً · تجريبي",

    // CTA
    ctaTitle: "امنح محادثتك القادمة بداية أقوى",
    ctaDescription:
      "أنشئ ذاكرتك، استخدم مزود الذكاء الاصطناعي الذي تفضله، وعُد والسياق حاضر أمامك.",
    ctaButton: "أنشئ حساباً مجانياً",

    // Footer
    footerDescription: "ذاكرة ذكاء اصطناعي تبقى معك — تحدث، واسترجع السياق، وانقله معك.",
    footerRights: "جميع الحقوق محفوظة.",
    footerPrivacy: "سياسة الخصوصية",
    footerTerms: "سياسة الاستخدام",
    footerHelp: "المساعدة",
    footerContact: "تواصل معنا عبر X",
    helpTitle: "المساعدة",
    helpDescription: "هل تحتاج إلى مساعدة أو ترغب في مشاركة اقتراح؟ تواصل معنا عبر X وسنسعد بمساعدتك.",
    privacyTitle: "سياسة الخصوصية",
    privacyDescription: "يخزن PermaMind المحادثات والإعدادات محلياً في متصفحك بشكل افتراضي. ذاكرتك قابلة للنقل وتحت تحكمك: يمكنك تصديرها واستعادتها واستخدام مزود ذكاء اصطناعي مختلف. لا يرسل مزود الذكاء الاصطناعي إلا الرسائل والسياق اللازمين لإنشاء الرد. يتم تشفير النسخ الاحتياطية الاختيارية محلياً قبل رفعها، ولا تصل عبارة مرور التشفير إلى الخادم أو مزود الذكاء الاصطناعي. أما الرفعات إلى Arweave فهي دائمة ولا يمكن حذفها.",
    privacySections: [
      {
        title: "ما الذي نخزّنه",
        body: "تبقى المحادثات والإعدادات في متصفحك بشكل افتراضي. لا نبيع محادثاتك ولا نؤجرها ولا نستخدمها لأغراض تسويقية.",
      },
      {
        title: "ذاكرة تحت تحكمك",
        body: "يمكنك تصدير ذاكرتك واستعادتها واستخدام مزود ذكاء اصطناعي مختلف. تبقى عبارة مرور التشفير على جهازك ولا تُرسل إلى الخادم أو مزود الذكاء الاصطناعي.",
      },
      {
        title: "ما يُرسل إلى مزود الذكاء الاصطناعي",
        body: "لا يُرسل إلا الرسائل والسياق اللازمان لإنشاء الرد. راجع ما تشاركه قبل ربط عملاء MCP مثل Claude أو Cursor أو Codex.",
      },
      {
        title: "النسخ الاحتياطية الاختيارية",
        body: "تُشفَّر النسخ الاحتياطية الاختيارية محلياً قبل رفعها. الرفعات إلى Arweave دائمة ولا يمكن حذفها بعد تأكيدها.",
      },
    ],
    termsTitle: "سياسة الاستخدام",
    termsDescription: "استخدم PermaMind بشكل قانوني ومسؤول. قد تكون إجابات الذكاء الاصطناعي غير دقيقة، لذلك راجع المعلومات المهمة ولا تعتبر الخدمة بديلاً عن الاستشارات القانونية أو الطبية أو المالية أو الدينية. أنت مسؤول عن المحتوى الذي تدخله وعن حماية مفاتيحك.",
    termsSections: [
      {
        title: "الاستخدام المقبول",
        body: "استخدم PermaMind بشكل قانوني ومسؤول. لا تستخدمه للإضرار بالآخرين أو انتهاك الحقوق أو نشر محتوى غير قانوني أو تعطيل الخدمة.",
      },
      {
        title: "إجابات الذكاء الاصطناعي",
        body: "قد تكون الإجابات غير دقيقة. راجع المعلومات المهمة ولا تعتبر الخدمة بديلاً عن الاستشارة القانونية أو الطبية أو المالية أو الدينية.",
      },
      {
        title: "محتواك ومفاتيحك",
        body: "أنت مسؤول عن المحتوى الذي تدخله وعن حماية مفاتيح واجهة البرمجة وعبارة مرور التشفير.",
      },
      {
        title: "التخزين الدائم",
        body: "النسخ الاحتياطية على Arweave اختيارية. بعد رفعها تصبح دائمة ولا يمكن التراجع عنها. تأكد من ذلك قبل تفعيل النسخ الدائم.",
      },
    ],
    legalBack: "العودة للرئيسية",
    legalUpdated: "آخر تحديث",
    storageGuideTitle: "اختر كيف تُخزَّن بياناتك",
    storageGuideDescription: "المحلي والسحابي وArweave طرق منفصلة. تشغيل واحدة لا يغيّر الأخريين، واختيار المحتوى لا يرفع شيئاً وحده.",
    storageGuideBack: "العودة للنسخ الاحتياطي",
    storageGuideSections: [
      {
        title: "محلي",
        body: "يعمل دائماً. تبقى المحادثات على هذا الجهاز ولا تُرفع. مسح هذا المتصفح قد يحذفها، لذا صدّر نسخة إذا احتجت إليها.",
      },
      {
        title: "سحابي (Supabase)",
        body: "اختياري ومنفصل عن Arweave. بعد تشغيله تختار المحادثات أو الذكريات أو المشاريع. يُرسل الملخص المشفّر الذي اخترته فقط، وبعد تحذير منفصل وتأكيدك. يمكن حذف بيانات السحابة لاحقاً. عبارة مرور المزامنة تبقى في الذاكرة ويجب إدخالها مرة أخرى على جهاز آخر.",
      },
      {
        title: "Arweave",
        body: "اختياري ومنفصل عن التخزين السحابي. بعد تشغيله تختار المحادثات التي قد تدخل النسخة الدائمة. تُشفَّر النسخة داخل هذا المتصفح قبل الرفع. بعد الرفع لا يمكن حذفها. فقدان عبارة المرور يعني عدم القدرة على فك تلك النسخة.",
      },
    ],
  },
} as const;

export type TranslationKey = keyof (typeof translations)["en"];