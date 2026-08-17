export type Locale = "en" | "ar";

export const translations = {
  en: {
    // Header
    signIn: "Sign In",
    signUp: "Sign Up",
    languageToggle: "AR",

    // Hero
    heroBadge: "Personal AI memory for your work",
    heroTitle: "AI that remembers",
    heroTitleHighlight: "your work",
    heroTitleEnd: "across every conversation.",
    heroDescription:
      "PermaMind remembers your projects, decisions, and ideas across conversations — with optional encrypted, permanent backups on Arweave when you want your memory to outlast a device or platform.",
    heroCta: "Start building your memory",
    heroSecondary: "See how it works",
    proofLabel: "A searchable memory for your AI work",
    proofQuestion: "What did we decide about the backup architecture last month?",
    proofAnswer: "You chose client-side encryption with an optional Arweave backup for portability and recovery.",
    proofSource: "Based on 3 conversations · View sources",
    trustTitle: "Your projects stay connected to the context behind them.",
    trustDescription:
      "PermaMind turns your conversations into searchable project memory. You decide what to keep, export your memory whenever you need it, and can create an optional encrypted long-term backup on Arweave.",
    trustItems: [
      "Local-first conversations",
      "Bring your own AI key",
      "Encrypted backups are optional",
      "Portable memory you can restore",
    ],

    // Features
    featuresTitle: "Your work deserves more than chat history",
    featuresDescription:
      "Turn scattered conversations into useful context for your projects, while keeping control of where your memory lives.",
    features: [
      {
        title: "Personal Memory",
        description:
          "Your conversations are summarized into useful context you can search, export, and carry between AI providers.",
        icon: "brain",
      },
      {
        title: "Smart Retrieval",
        description:
          "PermaMind automatically retrieves relevant memories to provide contextual, personalized responses.",
        icon: "search",
      },
      {
          title: "Arweave Backups",
        description:
          "Create optional encrypted backups on Arweave — designed to remain available long-term and recoverable with your passphrase.",
        icon: "shield",
      },
      {
        title: "Internet Search",
        description:
          "When memory isn't enough, PermaMind searches the web to give you the most complete answer.",
        icon: "globe",
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

    // How it works
    howItWorksTitle: "How It Works",
    howItWorksDescription:
      "A simple pipeline that makes your AI truly remember you.",
    steps: [
      {
        title: "Chat Naturally",
        description: "Talk to PermaMind like you would with any AI assistant.",
      },
      {
        title: "Memory Extraction",
        description:
          "PermaMind automatically extracts and stores important information from your conversations.",
      },
      {
        title: "Contextual Recall",
        description:
          "Next time you chat, relevant memories are retrieved to personalize the response.",
      },
      {
        title: "Encrypted Arweave Backup",
        description:
          "When you choose it, your data is encrypted locally before being uploaded to Arweave. Uploaded backups are permanent and cannot be deleted.",
      },
    ],

    // CTA
    ctaTitle: "Give your next conversation a head start",
    ctaDescription:
      "Create your personal AI memory, bring your own provider, and return to your work with the context already there.",
    ctaButton: "Create Free Account",

    // Footer
    footerDescription: "AI memory platform — chat, save, and restore context.",
    footerRights: "All rights reserved.",
    footerPrivacy: "Privacy Policy",
    footerTerms: "Terms of Use",
    footerHelp: "Help",
    footerContact: "Contact us on X",
    helpTitle: "Help",
    helpDescription: "Need help or want to share feedback? Contact us on X and we will be happy to help.",
    privacyTitle: "Privacy Policy",
    privacyDescription: "PermaMind stores conversations and settings locally in your browser by default. Memory is portable and user-controlled: you can export and restore it, and use a different AI provider. Your AI provider receives only the messages and context needed to generate a response. Optional backups are encrypted locally before upload; the server and AI provider never receive your encryption passphrase. Arweave uploads are permanent and cannot be deleted.",
    termsTitle: "Terms of Use",
    termsDescription: "Use PermaMind lawfully and responsibly. AI responses may be inaccurate, so review important information and do not treat the service as professional legal, medical, financial, or religious advice. You are responsible for the content you enter and for keeping your keys secure.",
  },

  ar: {
    // Header
    signIn: "تسجيل الدخول",
    signUp: "إنشاء حساب",
    languageToggle: "English",

    // Hero
    heroBadge: "ذاكرة شخصية لعملك مع الذكاء الاصطناعي",
    heroTitle: "ذكاء اصطناعي يتذكر",
    heroTitleHighlight: "عملك",
    heroTitleEnd: "في كل محادثة.",
    heroDescription:
      "يتذكر PermaMind مشاريعك وقراراتك وأفكارك عبر المحادثات، مع نسخ احتياطية مشفرة ودائمة اختيارية على Arweave عندما تريد أن تتجاوز ذاكرتك جهازاً أو منصة واحدة.",
    heroCta: "ابدأ ببناء ذاكرتك",
    heroSecondary: "شاهد كيف يعمل",
    proofLabel: "ذاكرة قابلة للبحث لعملك مع الذكاء الاصطناعي",
    proofQuestion: "ما القرار الذي اتخذناه بشأن بنية النسخ الاحتياطي الشهر الماضي؟",
    proofAnswer: "اخترت التشفير من طرف العميل مع نسخة احتياطية اختيارية على Arweave لضمان قابلية النقل والاستعادة.",
    proofSource: "استناداً إلى 3 محادثات · عرض المصادر",
    trustTitle: "تبقى مشاريعك مرتبطة بسياقها وقراراتها.",
    trustDescription:
      "يحوّل PermaMind محادثاتك إلى ذاكرة قابلة للبحث داخل مشاريعك. أنت تحدد ما تريد الاحتفاظ به، وتستطيع تصدير ذاكرتك عند الحاجة، مع خيار إنشاء نسخة احتياطية مشفرة طويلة الأمد على Arweave.",
    trustItems: [
      "محادثات محلية أولاً",
      "استخدم مفتاح AI الخاص بك",
      "النسخ المشفرة اختيارية",
      "ذاكرة قابلة للنقل والاستعادة",
    ],

    // Features
    featuresTitle: "عملك يستحق أكثر من سجل محادثات",
    featuresDescription:
      "حوّل محادثاتك المتفرقة إلى سياق مفيد لمشاريعك، مع بقاء التحكم في مكان ذاكرتك بيدك.",
    features: [
      {
        title: "ذاكرة شخصية",
        description:
          "تُلخّص محادثاتك إلى سياق مفيد يمكنك البحث فيه وتصديره ونقله بين مزودي الذكاء الاصطناعي.",
        icon: "brain",
      },
      {
        title: "استرجاع ذكي",
        description:
          "يسترجع PermaMind تلقائياً الذكريات ذات الصلة لتقديم إجابات مخصصة وسياقية.",
        icon: "search",
      },
      {
        title: "نسخ احتياطية عبر Arweave",
        description:
          "أنشئ نسخاً احتياطية مشفرة اختيارية على Arweave، مصممة للبقاء متاحة على المدى الطويل وقابلة للاستعادة بعبارة المرور الخاصة بك.",
        icon: "shield",
      },
      {
        title: "بحث في الإنترنت",
        description:
          "عندما لا تكفي الذاكرة، يبحث PermaMind في الويب ليعطيك الإجابة الأكثر اكتمالاً.",
        icon: "globe",
      },
    ],

    // MCP
    mcpTitle: "ذاكرتك المسموح بها أينما تعمل",
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
          "في المرة القادمة التي تتحدث فيها، يتم استرجاع الذكريات ذات الصلة لتخصيص الإجابة.",
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