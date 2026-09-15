export type Locale = "en" | "ar";

export const translations = {
  en: {
    // Header
    signIn: "Sign In",
    signUp: "Sign Up",
    languageToggle: "AR",

    // Hero
    heroBadge: "Permanent, encrypted AI memory",
    heroTitle: "AI memory that no company can",
    heroTitleHighlight: "delete, ban, or hold hostage.",
    heroTitleEnd: "",
    heroDescription:
      "PermaMind backs up your AI conversations to Arweave — permanent, encrypted, and owned by you. Lose your account, switch AI providers, get banned — your memory survives.",
    heroCta: "Claim your free storage gift",
    heroSecondary: "See how it works",
    heroTrust: "Your encryption passphrase never leaves your device. Even we can't read your backups.",
    proofLabel: "Memory you own",
    proofStatus: "PermaMind memory recall",
    proofQuestion: "What did we decide about the backup architecture last month?",
    proofAnswer: "You chose client-side encryption with an optional Arweave backup for portability and recovery.",
    proofSource: "Based on 3 conversations · View sources",
    trustTitle: "Your data stays yours when a platform disappears.",
    trustDescription:
      "PermaMind keeps your conversations local by default. Choose what to encrypt and preserve permanently on Arweave. You control the passphrase, and your memory can outlive any platform.",
    trustItems: [
      "Local-first by default",
      "Bring your own AI key",
      "Encrypted before upload",
      "Permanent backup you control",
    ],

    // Free storage gift
    freeTierTitle: "Every new account receives a free permanent Arweave storage gift — no credit card required.",
    freeTierDescription:
      "Use it to preserve the conversations that matter. You can expand it later with other payment options, including ETH and SOL.",
    freeTierNote: "The gift is added to your account after signup.",

    // Features
    featuresTitle: "Your memory should outlive every platform",
    featuresDescription:
      "Keep the conversations that matter. Search them, export them, and choose what becomes permanent — without giving up control.",
    features: [
      {
        title: "Permanent, Uncensorable Memory",
        description:
          "Create optional encrypted backups on Arweave. Once uploaded, your data is designed to remain permanent and recoverable only with your passphrase — not controlled by any platform.",
        icon: "shield",
      },
      {
        title: "Personal Memory + Smart Retrieval",
        description:
          "Turn conversations into searchable memory you control. PermaMind brings back the context that matters, and you can export or carry it between AI providers.",
        icon: "brain",
      },
    ],

    // MCP
    mcpTitle: "Your approved memory, wherever you work",
    mcpDescription:
      "Connect PermaMind to Cursor, Claude, OpenAI Codex, or another MCP client through a read-only interface. You choose which summaries can be shared; full conversations, encrypted backups, and private keys stay out of reach.",
    mcpPoints: [
      "Read-only access to approved summaries",
      "Works with Cursor, Claude, and OpenAI Codex",
      "You control what is shared",
      "Privacy warning before every export or connection",
    ],
    mcpCta: "Learn about MCP in Settings",
    mcpCardTitle: "Read-only memory bridge",
    mcpCardSubtitle: "PermaMind → Cursor / Claude / Codex",
    mcpCardConnect: "Connect after signing in and explicitly approve the summaries you want to share.",

    // How it works
    howItWorksTitle: "How your memory survives",
    howItWorksDescription:
      "A simple path from conversation to permanent, encrypted ownership.",
    steps: [
      {
        title: "Chat Naturally",
        description: "Talk to PermaMind with the AI provider you choose.",
      },
      {
        title: "Choose What to Preserve",
        description: "Keep the conversations that matter. Arweave backups remain optional.",
      },
      {
        title: "Encrypt on Your Device",
        description: "Your data is encrypted locally before it leaves your browser.",
      },
      {
        title: "Store Permanently on Arweave",
        description: "Once uploaded, your encrypted backup is designed to remain permanent and recoverable with your passphrase.",
      },
    ],

    // Internet Search
    searchTitle: "Internet Search",
    searchDescription:
      "When your memory isn't enough, PermaMind can search the live web through Exa to give you a more complete answer.",
    searchBadge: "Coming soon · Beta",

    // CTA
    ctaTitle: "Your memory should outlive the platform.",
    ctaDescription:
      "Create your account, claim your free permanent storage gift, and keep your conversations under your control.",
    ctaButton: "Claim your free storage gift",

    // Footer
    footerDescription: "Permanent AI memory you own — chat, preserve, and restore your context.",
    footerRights: "All rights reserved.",
    footerPrivacy: "Privacy Policy",
    footerTerms: "Terms of Use",
    footerHelp: "Help",
    footerContact: "Contact us on X",
    helpTitle: "Help",
    helpDescription: "Need help or want to share feedback? Contact us on X and we will be happy to help.",
    privacyTitle: "Privacy Policy",
    privacyDescription: "PermaMind stores conversations and settings locally in your browser by default. You control what is encrypted and uploaded to Arweave. Your encryption passphrase never reaches the server or AI provider. Arweave backups are permanent and cannot be deleted, so review your storage policy before uploading.",
    termsTitle: "Terms of Use",
    termsDescription: "Use PermaMind lawfully and responsibly. AI responses may be inaccurate, so review important information and do not treat the service as professional legal, medical, financial, or religious advice. You are responsible for the content you enter and for keeping your keys secure.",
  },

  ar: {
    // Header
    signIn: "تسجيل الدخول",
    signUp: "إنشاء حساب",
    languageToggle: "EN",

    // Hero
    heroBadge: "ذاكرة ذكاء اصطناعي دائمة ومشفرة",
    heroTitle: "ذاكرة ذكاء اصطناعي لا تستطيع أي شركة",
    heroTitleHighlight: "حذفها أو حظرها.",
    heroTitleEnd: " تبقى معك دائمًا، وتملكها إلى الأبد.",
    heroDescription:
      "يحفظ PermaMind محادثاتك مع الذكاء الاصطناعي احتياطيًا على Arweave — دائمة ومشفرة ومملوكة لك. افقد حسابك، أو بدّل مزوّد الذكاء الاصطناعي، أو تعرّض للحظر — تبقى ذاكرتك معك.",
    heroCta: "احصل على هدية تخزين مجانية",
    heroSecondary: "شاهد كيف يعمل",
    heroTrust: "عبارة تشفيرك لا تغادر جهازك أبدًا. حتى نحن لا نستطيع قراءة نسخك الاحتياطية.",
    proofLabel: "ذاكرة تمتلكها أنت",
    proofStatus: "استدعاء ذاكرة PermaMind",
    proofQuestion: "ما الذي قررناه بشأن بنية النسخ الاحتياطي الشهر الماضي؟",
    proofAnswer: "اخترت التشفير على جهازك مع نسخة احتياطية اختيارية على Arweave لتتمكن من نقل ذاكرتك واستعادتها.",
    proofSource: "استنادًا إلى 3 محادثات · عرض المصادر",
    trustTitle: "تبقى بياناتك ملكًا لك حتى إذا اختفت المنصة نفسها.",
    trustDescription:
      "يحافظ PermaMind على محادثاتك محليًا بشكل افتراضي. اختر ما تريد تشفيره وحفظه دائمًا على Arweave. أنت تتحكم في عبارة المرور، ويمكن لذاكرتك أن تعيش أطول من أي منصة.",
    trustItems: [
      "محلي أولًا بشكل افتراضي",
      "استخدم مفتاح الذكاء الاصطناعي الخاص بك",
      "تشفير قبل الرفع",
      "نسخة احتياطية دائمة تحت سيطرتك",
    ],

    // Free storage gift
    freeTierTitle: "كل حساب جديد يحصل على هدية تخزين دائم مجانية على Arweave — بدون بطاقة ائتمان.",
    freeTierDescription:
      "استخدمها لحفظ المحادثات المهمة. ويمكنك زيادة المساحة لاحقًا بخيارات دفع أخرى، منها ETH وSOL.",
    freeTierNote: "تُضاف الهدية إلى حسابك بعد إكمال التسجيل.",

    // Features
    featuresTitle: "ينبغي لذاكرتك أن تعيش أطول من أي منصة",
    featuresDescription:
      "احتفظ بالمحادثات المهمة. ابحث فيها، وصدّرها، واختر ما يصبح دائمًا — من دون أن تتنازل عن السيطرة.",
    features: [
      {
        title: "ذاكرة دائمة لا يمكن حذفها",
        description:
          "أنشئ نسخًا احتياطية مشفرة اختيارية على Arweave. بعد الرفع، صُممت بياناتك لتبقى دائمة ولا يمكن استعادتها إلا بعبارة المرور الخاصة بك — وليس بيد أي منصة التحكم بها.",
        icon: "shield",
      },
      {
        title: "ذاكرة شخصية + استرجاع ذكي",
        description:
          "حوّل محادثاتك إلى ذاكرة قابلة للبحث وتمتلكها. يعيد PermaMind السياق المهم عند الحاجة، ويمكنك تصدير ذاكرتك أو نقلها بين مزودي الذكاء الاصطناعي.",
        icon: "brain",
      },
    ],

    // MCP
    mcpTitle: "ذاكرتك أينما تعمل",
    mcpDescription:
      "اربط PermaMind مع Cursor أو Claude أو OpenAI Codex أو أي عميل MCP عبر واجهة للقراءة فقط. أنت تحدد الملخصات التي يمكن مشاركتها؛ ولا يتم كشف المحادثات الكاملة أو النسخ المشفرة أو المفاتيح الخاصة.",
    mcpPoints: [
      "وصول للقراءة فقط إلى الملخصات المسموح بها",
      "يعمل مع Cursor وClaude وOpenAI Codex",
      "أنت تتحكم فيما تتم مشاركته",
      "تحذير خصوصية قبل أي تصدير أو اتصال",
    ],
    mcpCta: "تعرّف على MCP في الإعدادات",

    // How it works
    howItWorksTitle: "كيف يعمل",
    howItWorksDescription: "خطوات بسيطة تجعل ذكاءك الاصطناعي يتذكرك حقاً.",
    steps: [
      {
        title: "تحدث بشكل طبيعي",
        description: "تحدث مع PermaMind كما تتحدث مع أي مساعد ذكاء اصطناعي.",
      },
      {
        title: "استخراج الذاكرة",
        description:
          "يستخرج PermaMind تلقائياً المعلومات المهمة من محادثاتك ويخزنها.",
      },
      {
        title: "استرجاع سياقي",
        description:
          "في المرة القادمة التي تتحدث فيها، يتم استرجاع الذكريات ذات الصلة لتخصيص الإجابة مع فهم كامل لما قلته في المحادثات السابقة.",
      },
      {
        title: "نسخة Arweave مشفرة",
        description:
          "عند اختيارك لذلك، يتم تشفير بياناتك محلياً قبل رفعها إلى Arweave. النسخ المرفوعة دائمة ولا يمكن حذفها.",
      },
    ],

    // CTA
    ctaTitle: "امنح محادثتك القادمة بداية أقوى",
    ctaDescription:
      "أنشئ ذاكرتك الشخصية، استخدم مزود الذكاء الاصطناعي الذي تفضله، وعد إلى عملك والسياق حاضر أمامك.",
    ctaButton: "أنشئ حساباً مجانياً",

    // Footer
    footerDescription: "منصة ذاكرة الذكاء الاصطناعي — تحدث، احفظ، واستعد السياق.",
    footerRights: "جميع الحقوق محفوظة.",
    footerPrivacy: "سياسة الخصوصية",
    footerTerms: "سياسة الاستخدام",
    footerHelp: "المساعدة",
    footerContact: "تواصل معنا عبر X",
    helpTitle: "المساعدة",
    helpDescription: "هل تحتاج إلى مساعدة أو ترغب في مشاركة اقتراح؟ تواصل معنا عبر X وسنسعد بمساعدتك.",
    privacyTitle: "سياسة الخصوصية",
    privacyDescription: "يخزن PermaMind المحادثات والإعدادات محلياً في متصفحك بشكل افتراضي. ذاكرتك قابلة للنقل وتحت تحكمك: يمكنك تصديرها واستعادتها واستخدام مزود ذكاء اصطناعي مختلف. لا يرسل مزود الذكاء الاصطناعي إلا الرسائل والسياق اللازمين لإنشاء الرد. يتم تشفير النسخ الاحتياطية الاختيارية محلياً قبل رفعها، ولا تصل عبارة مرور التشفير إلى الخادم أو مزود الذكاء الاصطناعي. أما الرفعات إلى Arweave فهي دائمة ولا يمكن حذفها.",
    termsTitle: "سياسة الاستخدام",
    termsDescription: "استخدم PermaMind بشكل قانوني ومسؤول. قد تكون إجابات الذكاء الاصطناعي غير دقيقة، لذلك راجع المعلومات المهمة ولا تعتبر الخدمة بديلاً عن الاستشارات القانونية أو الطبية أو المالية أو الدينية. أنت مسؤول عن المحتوى الذي تدخله وعن حماية مفاتيحك.",
  },
} as const;

export type TranslationKey = keyof (typeof translations)["en"];