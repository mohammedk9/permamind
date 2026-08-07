# Phase 11 — PermaMind UI Redesign Implementation Blueprint

**Status:** Planning only — no implementation in this phase
**Audience:** Product, design, frontend engineering, QA, and future implementation agents
**Scope:** User experience and presentation only

## 0. Product contract and non-goals

Phase 11 turns the existing chat-first interface into a modern SaaS product organized around **Chat, Memory, Backup, and Settings**. Existing backend behavior is assumed correct and production-ready. The redesign must preserve existing hooks, storage, API routes, state transitions, and side effects.

The following remain unchanged: OpenRouter streaming, Free mode, BYOK, summaries, retrieval, search, snapshots, encryption, deduplication, upload queue, restore, quota, conversation persistence, scoring, analytics, help, and onboarding. UI work may change where and how these capabilities are exposed, but not what they do or what data they produce.

### Product principles

1. **Memory first:** Explain remembered context without making users understand retrieval internals.
2. **Trust by default:** Make local, encrypted, and permanent data boundaries visible at the moment they matter.
3. **Progressive disclosure:** Keep the primary workflow calm; expose advanced controls on demand.
4. **State clarity:** Every loading, streaming, queued, failed, restored, and saved state has a visible explanation and next action.
5. **No capability loss:** Every current control has a destination in the new information architecture.

## 11.1 Information Architecture

### Objective

Replace the overloaded chat sidebar and nested sheets with a clear primary navigation hierarchy.

### Why it exists

The current sidebar combines conversation history, memory search, insights, settings, help, snapshots, analytics, and storage actions. This makes important capabilities difficult to discover and creates competing visual priorities. Four first-class product areas provide a stable mental model while retaining chat as the default landing experience.

### Screens affected

- App shell and global navigation
- Chat home and conversation detail
- Memory home and memory detail
- Backup center and restore flow
- Settings hub and section views
- Onboarding, help, notifications, and account/status surfaces

### Components affected

- Existing `ChatApp`, `ChatSidebar`, `ChatMain`, `SettingsDialog`, `SnapshotSettings`, `QueueStatus`, `MemoryInsightsPanel`, and `HelpSheet` become presentation clients of the new shell rather than the primary information architecture.
- Conversation list/search moves into Chat.
- Memory search, recalled items, insights, and explanation move into Memory.
- Snapshot settings, quota, status, queue, restore, and Arweave explanation move into Backup.
- API, memory policy, backup preferences, privacy, and advanced controls move into Settings.

### Navigation hierarchy

1. **Chat** — default landing page; new conversation, recent conversations, search within conversations, and active conversation.
2. **Memory** — remembered items, search, recall history/context explanation, topics/entities/tags, and memory details.
3. **Backup** — permanent-storage education, storage usage, snapshot policy, passphrase, queue status, manual backup, and restore.
4. **Settings** — AI, Memory, Backups, Privacy, and Advanced sections.

Global utility actions: help/how it works, theme selector, notification/status center, and profile/device context if those already exist. They must not become new backend concepts.

### User movement

- Selecting **Chat** always returns to the active conversation or an empty new-chat state.
- Selecting **Memory** opens Memory Home while preserving the current conversation; selecting a memory can deep-link back to its source conversation/message.
- Selecting **Backup** opens Backup Center; actions open contained dialogs or stepped panels, never an unrelated settings sheet.
- Selecting **Settings** opens the last selected section, defaulting to AI on first visit.
- Memory indicators in Chat link to the relevant Memory detail/context view.
- Backup status indicators link to the relevant Backup queue or snapshot detail.
- Mobile uses a navigation drawer; desktop uses a persistent rail/sidebar; tablet uses a collapsible rail.

### Acceptance criteria

- All four destinations are reachable in one primary navigation interaction.
- No existing capability is only reachable through an undiscoverable nested sheet.
- Browser/back behavior returns users to the previous product area and preserves active conversation state.
- Deep links and refresh do not erase locally persisted conversations or settings.
- Navigation labels describe user outcomes, not implementation terms such as “snapshot pipeline.”

### Estimated complexity

**High** — shell and routing/state-preservation work affect every surface, although backend contracts remain unchanged.

### Required output

- Approved sitemap and route/state map
- Desktop, tablet, and mobile navigation wireframes
- Capability-to-destination matrix
- Deep-link and back-navigation rules

## 11.2 Design Language

### Objective

Create one coherent visual system for a trustworthy, calm, memory-oriented SaaS product.

### Why it exists

The current UI uses individually styled controls and dense utility panels. A shared language reduces cognitive load, makes states recognizable, and lets future screens be implemented without repeated product decisions.

### Screens affected

All screens, dialogs, drawers, banners, empty states, and onboarding.

### Components affected

Design tokens, typography primitives, buttons, fields, cards, badges, dialogs, sheets, tabs, navigation, toasts, progress indicators, tooltips, and empty/error states.

### Specification

- **Typography:** Use a neutral, highly legible sans-serif. Establish display, page title, section title, body, label, caption, and code/data roles. Body text must remain comfortable at mobile widths; do not use all-caps for long labels.
- **Spacing:** Use a consistent 4px base scale with 8px as the primary rhythm. Use generous page padding and compact control padding; preserve denser data layouts only in queue/analytics tables.
- **Radius:** Use small radius for fields and compact controls, medium radius for cards, and large radius for prominent empty states and dialogs. Avoid mixing arbitrary radii.
- **Elevation:** Prefer borders and surface contrast; reserve shadows for floating menus, dialogs, drawers, and elevated composer states. Avoid decorative shadows on every card.
- **Icons:** Use one consistent outline icon family. Icons supplement labels, never replace essential labels. Every status icon has text or an accessible name.
- **Motion:** Use short, purposeful transitions for navigation, drawers, streaming indicators, and status changes. Streaming animation must not imply progress that cannot be measured. Respect reduced-motion preferences.
- **Themes:** Dark and light themes share semantic tokens, not separate ad hoc colors. Verify text, borders, status colors, charts, code, and focus rings in both themes.
- **Cards:** Cards group one decision or one piece of information. Use title, supporting explanation, status, and action hierarchy consistently. Avoid nesting more than two card levels.
- **Dialogs:** Use dialogs for confirmation, destructive actions, passphrase/restore decisions, and focused one-step tasks. Use full-page or routed surfaces for multi-section settings and Backup Center.
- **Empty states:** Explain what the area is, why it is empty, and the single best next action. Never use “No data” alone.
- **Status indicators:** Define semantic states: neutral, active/in-progress, success, attention, error, and protected. Pair color with icon/text and an action where applicable.

### Acceptance criteria

- A designer can specify any new screen using the documented semantic roles without inventing colors, spacing, or status language.
- Light/dark and reduced-motion reviews pass for every shared primitive.
- Destructive, permanent, encrypted, and queued states are visually distinct and textually explicit.

### Estimated complexity

**Medium** — system definition and visual QA are broad; implementation is foundational.

### Required output

- Design token and component usage specification
- Theme and status-color matrix
- Typography and spacing samples
- Motion and content guidelines

## 11.3 Chat Experience

### Objective

Make chat the fastest and clearest place to ask questions while making memory behavior understandable without interrupting conversation.

### Why it exists

Chat is the core workflow, but the current sidebar and header compete with the conversation. The redesigned experience must prioritize reading, composing, and understanding when prior context was used.

### Screens affected

- Chat Home / new conversation
- Active conversation
- Conversation list and search
- Mobile chat drawer
- Free-limit and API configuration prompts

### Components affected

Conversation list, conversation row, list filters, chat header, model/mode control, message list, user message, assistant message, markdown/content renderer, memory-used strip, composer, streaming indicator, error banner, summary indicator, usage indicator, and free-limit dialog.

### User flow

1. User lands on Chat with recent conversations and a prominent new-chat action.
2. User starts typing in the composer; model and mode remain visible but secondary.
3. On send, show the user message immediately, then a clearly labeled assistant streaming state.
4. If memories are retrieved, show a non-blocking “Remembered from…” indicator that can expand to sources/explanation.
5. On success, show completed assistant content, summary activity if applicable, and the existing backup status without interrupting reading.
6. On failure or blocked mode, preserve the message context and provide the correct existing recovery action.
7. Conversation rename, star, delete, and permanent-memory controls remain available from a row menu/header menu with explicit confirmation for irreversible storage.

### Required states

New/empty, hydrated/loading, active, streaming, summarizing, memory-found, no-memory-found, API-not-configured, invalid-key, free-limit-reached, request-error, retryable failure, saved-locally, and backup-queued. State copy must distinguish “not yet completed” from “nothing found.”

### Acceptance criteria

- Streaming remains incremental and never loses partial content on visual updates.
- Composer supports keyboard submit, multiline editing, disabled/loading, and mobile touch targets.
- Conversation search remains available without conflating it with global Memory search.
- Memory indicators expose why a memory is shown and link to source context without changing retrieval.
- Existing Free/BYOK/model controls, summaries, analytics, and persistence remain available.

### Estimated complexity

**High** — most visible surface and many asynchronous states, despite unchanged chat logic.

### Required output

- Chat desktop/tablet/mobile wireframes
- Message and composer state matrix
- Copy deck for streaming, memory, errors, limits, and success
- Interaction specification for conversation actions

## 11.4 Memory Experience

### Objective

Give users a dedicated, understandable view of what PermaMind remembers and why it appears in a response.

### Why it exists

Memory is currently experienced indirectly through search and small insight panels. A first-class Memory area turns retrieval into a product benefit without exposing or altering retrieval logic.

### Screens affected

- Memory Home
- Memory search/results
- Memory detail
- Recall/explanation panel opened from Chat
- Insights and remembered-items views

### Components affected

Memory overview header, search field, filters, memory card, source/conversation reference, relevance/recall indicator, explanation panel, topic/entity/tag chips, insight summary, empty state, and detail drawer/page.

### User flow

1. Memory Home explains that memories are derived from saved conversations and presents recent/relevant remembered items and high-level insights.
2. User searches using the existing memory index/search behavior.
3. Results show concise content, source conversation, date/context, and a plain-language reason it is relevant.
4. Selecting an item opens Memory Detail with source references and a “View conversation” action.
5. From Chat, opening the memory indicator lands on the same detail/context model and returns to the conversation at the prior location.

### Required states

First-use, populated, search-active, no results, loading/hydration, source unavailable, recalled in current response, not recalled, and privacy/permanence explanation states.

### Acceptance criteria

- No UI claims that a memory was created, deleted, scored, or retrieved unless the existing data says so.
- Search, recall, topic/entity/tag insights, and source navigation preserve current behavior.
- Each item makes provenance and confidence/relevance language understandable without exposing sensitive implementation details.
- Empty states explain how conversations become useful memory.

### Estimated complexity

**High** — a new product area and detail experience must map carefully to current conversation-based data.

### Required output

- Memory information model and content hierarchy
- Memory card/detail wireframes
- Search/filter behavior specification
- Recall explanation and provenance copy

## 11.5 Backup Experience

### Objective

Make permanent backup understandable, controllable, and safe while preserving snapshot, encryption, queue, quota, deduplication, upload, and restore behavior exactly.

### Why it exists

Backup actions are currently split between settings and snapshot sheets. Permanent storage is irreversible and therefore needs a dedicated trust-oriented center with clear status and confirmation.

### Screens affected

- Backup Center
- Storage usage and quota card
- Snapshot policy and passphrase setup
- Queue/activity view
- Manual backup confirmation/result
- Restore wizard and replacement confirmation
- Permanent-storage education

### Components affected

Backup overview, storage meter, policy selector, passphrase field/help, encryption explanation, backup action, queue status/list, retry action, snapshot history/version status, restore stepper, irreversible-action confirmation, quota dialog, and Arweave explanation card.

### User flow

1. Backup Center explains local availability versus permanent encrypted backup.
2. User sees storage usage, last successful upload, current queue, policy, and snapshot version.
3. User configures or updates passphrase with recovery guidance; passphrase is never displayed or transmitted by the UI beyond existing behavior.
4. User chooses automatic policy or manual backup using existing controls.
5. Manual backup shows confirmation where permanence matters, then queued/in-progress/success/failure result with next action.
6. Restore is a clearly separated flow: choose latest available snapshot, explain replacement, require explicit confirmation, show progress, and return to refreshed local conversations.
7. Quota exhaustion explains that local conversations remain available and points to the existing supported resolution without inventing payment behavior.

### Acceptance criteria

- Users can always distinguish local persistence, encrypted snapshot, queued upload, successful permanent upload, and restore.
- Permanent/non-deletable implications appear before confirmation, not after the action.
- Queue counts, retry, last-uploaded time, version, quota, and restore outcomes reflect existing sources of truth.
- Passphrase requirements and loss consequences are explicit, but encryption implementation is untouched.
- No UI implies that Arweave data can be deleted or that a restore is reversible unless the backend supports it.

### Estimated complexity

**High** — safety-critical flows, asynchronous states, and responsive stepper/dialog behavior.

### Required output

- Backup Center wireframes and state matrix
- Restore confirmation/progress/error flow
- Permanence, encryption, quota, and queue copy deck
- Mapping of every current snapshot control to its new location

## 11.6 Settings

### Objective

Turn the current mixed API/backup/settings sheet into a predictable settings hub with progressive disclosure.

### Why it exists

AI configuration, backup operations, privacy choices, onboarding, and storage status currently share one long panel. Logical sections reduce accidental changes and let most users stay in simple defaults.

### Screens affected

- Settings landing page
- AI settings
- Memory settings
- Backups settings
- Privacy settings
- Advanced settings

### Components affected

Settings navigation, section header, setting row, description/help link, mode selector, BYOK key field/status, model selector, memory policy controls, backup policy/passphrase links, privacy controls, reset onboarding, analytics/diagnostics controls, and advanced disclosure.

### Section rules

- **AI:** Free/BYOK mode, API key, validation status, model defaults, free usage explanation.
- **Memory:** memory visibility/explanation preferences, search/recall presentation preferences, and existing memory-related controls only.
- **Backups:** links or compact controls for snapshot policy, passphrase, automatic backup, storage, queue, and restore; full operations remain in Backup Center.
- **Privacy:** local storage, encryption, permanent storage, deletion/export explanations and available controls.
- **Advanced:** diagnostics/analytics, reset onboarding, and implementation-level options. Keep collapsed and clearly warn before changes.

### User flow

User opens Settings, sees section summary/status, selects one section, changes a setting, receives immediate existing confirmation/status, and can return without losing unsaved field input. Sensitive/destructive settings require confirmation.

### Acceptance criteria

- A first-time user can configure Free mode or BYOK without seeing backup internals.
- Backup operations are not duplicated with conflicting controls across Settings and Backup Center.
- Advanced controls are hidden until requested and labeled for their consequences.
- Existing validation, key storage, onboarding reset, analytics, and backup settings remain wired to their current behavior.

### Estimated complexity

**Medium-high** — information restructuring and stateful forms, with moderate visual implementation.

### Required output

- Settings sitemap and section wireframes
- Setting ownership matrix
- Progressive-disclosure and confirmation rules
- Form state and validation copy specification

## 11.7 Trust & Privacy

### Objective

Make data location, encryption, permanence, deletion, and export understandable at the point of decision.

### Why it exists

PermaMind handles local conversations, browser-stored BYOK credentials, encrypted snapshots, and permanent Arweave storage. Users need accurate explanations to make informed choices without reading implementation documentation.

### Screens affected

Onboarding, Chat permanence controls, Memory detail, Backup Center, Settings > Privacy, delete dialogs, export/restore explanations, and help.

### Components affected

Trust panel, data-location badge, encryption explainer, permanence warning, privacy disclosure, deletion confirmation, export explanation, passphrase warning, and contextual help link.

### Content rules

- Explicitly label **local data** as browser/device-persisted according to current behavior.
- Explain **encrypted backup** as encrypted before upload and dependent on the user’s passphrase, using only claims supported by the existing implementation.
- Explain **permanent data** as potentially irreversible; never offer a misleading delete promise.
- Distinguish deleting a local conversation from removing a permanent snapshot.
- Explain export/restore outcomes and replacement scope before action.
- Never display secrets, suggest that the server stores BYOK keys, or imply encryption guarantees beyond the current system.

### Acceptance criteria

- Every irreversible or sensitive action has plain-language consequence copy and explicit confirmation.
- Privacy copy is available from onboarding, relevant controls, and a central Privacy section.
- Accessibility and localization review confirms warnings are not conveyed by color alone.

### Estimated complexity

**Medium** — primarily content, interaction, and review quality; high product-risk if inaccurate.

### Required output

- Approved privacy/trust content deck
- Data-location and action-consequence matrix
- Confirmation and deletion/export flow specification

## 11.8 Responsive Design

### Objective

Deliver an equally usable experience across desktop, tablet, and mobile without removing capability.

### Why it exists

The current desktop sidebar and mobile sheet are not sufficient for four product areas, dense backup status, and memory details. Responsive behavior must be designed, not left to accidental wrapping.

### Screen rules

- **Desktop:** persistent navigation rail/sidebar, wide content canvas, optional secondary detail panel, full composer and queue summaries.
- **Tablet:** collapsible rail, two-column layouts only where content remains readable, drawers for secondary details.
- **Mobile:** navigation drawer, single-column cards, bottom-safe composer, full-screen flows for restore and settings sections, sticky primary actions where appropriate.

### Interaction requirements

- Minimum comfortable touch targets; no hover-only actions.
- Swipe/drawer behavior must not conflict with message scrolling.
- Preserve focus and scroll position when drawers close or users return from Memory/Backup.
- Support device safe areas around composer, dialogs, and bottom navigation/drawers.
- Tables/queue details become stacked summaries with an accessible details view.

### Acceptance criteria

- Core tasks work at narrow mobile widths: new chat, send, switch conversation, inspect memory, configure backup, and restore confirmation.
- No horizontal scrolling for primary content.
- Long titles, errors, passphrase guidance, and status labels wrap without obscuring actions.

### Estimated complexity

**High** — every major surface has distinct mobile interaction requirements.

### Required output

- Breakpoint behavior matrix
- Mobile/tablet wireframes for all critical flows
- Safe-area and touch-target checklist

## 11.9 Accessibility

### Objective

Make all product workflows operable, understandable, and perceivable with keyboard, assistive technology, and reduced motion.

### Requirements

- **Keyboard navigation:** logical order across shell, conversation list, messages, composer, drawers, dialogs, and settings. All actions reachable without pointer input.
- **ARIA:** landmarks for navigation/main/aside, correct names for icon buttons, live regions for streaming/status/toasts, expanded/collapsed state for disclosures, and appropriate dialog labeling.
- **Focus management:** move focus into opened dialogs/drawers, trap only where appropriate, return focus to the trigger, and preserve focus when streaming updates.
- **Contrast:** meet WCAG AA for text, controls, focus rings, status colors, disabled states, and both themes.
- **Reduced motion:** disable decorative motion and use instant/short transitions when requested; never communicate queue or streaming state only through animation.
- **Screen readers:** announce send/stream completion, errors, backup queue changes, restore outcomes, and search result counts without repeatedly reading the entire conversation.
- **Content:** headings follow hierarchy; labels explain consequences; error text identifies recovery; no color-only status.

### Acceptance criteria

- Keyboard-only completion of Chat, Memory search/detail, Backup manual backup/restore, and Settings configuration.
- Automated checks plus manual screen-reader review for all critical flows.
- Focus and live-region behavior documented per component state.

### Estimated complexity

**Medium-high** — shared primitives are manageable, but asynchronous flows require careful manual verification.

### Required output

- Accessibility acceptance checklist
- Focus/live-region map
- Keyboard interaction specification
- Screen-reader test script

## 11.10 Final Component Inventory

The following inventory is the implementation contract. “Props” describes data/events the presentation layer needs; it does not authorize API or backend changes.

| Component | Purpose | Props / inputs | States | Dependencies | Reuse possibilities |
|---|---|---|---|---|---|
| AppShell | Persistent product frame | active area, navigation callbacks, theme/status slots | loading, desktop, tablet, mobile | existing app state, theme | all product areas |
| PrimaryNavigation | Chat/Memory/Backup/Settings movement | active item, counts/status, collapse, select | expanded, collapsed, drawer, keyboard focus | router/state, icons | shell and mobile drawer |
| PageHeader | Consistent title/context/actions | title, description, breadcrumbs, actions | default, compact, loading | typography, buttons | every routed screen |
| StatusPill | Compact semantic status | status, label, detail, icon | neutral, active, success, attention, error, protected | status tokens | chat, backup, settings |
| SurfaceCard | Group related information | title, description, status, actions, children | default, selected, disabled, loading | elevation, disclosure | all dashboards |
| EmptyState | Explain empty area and next action | icon, title, explanation, action | first-use, no-results, unavailable | button, illustration/icon | Chat, Memory, Backup |
| ConfirmDialog | Safe confirmation for consequential actions | title, consequence, confirm/cancel labels, severity | closed, open, submitting, error | dialog/focus management | delete, permanent backup, restore |
| SearchField | Search input with clear/result semantics | value, placeholder, submit/change, result count | idle, active, loading, no-results | input, live region | Chat and Memory |
| ConversationList | Browse saved conversations | conversations, active ID, row actions, select | empty, populated, searching, loading | ConversationRow, scroll | Chat and mobile drawer |
| ConversationRow | Display and manage one conversation | conversation, active, summary state, actions | default, active, menu, deleting, permanent | menu, tooltip | Chat list/search results |
| ChatHeader | Active conversation controls | title, mode, model, memory/backup status, actions | new, active, streaming, mobile | PageHeader, selectors | Chat |
| MessageList | Render conversation sequence | messages, streaming ID, scroll behavior | empty, populated, streaming, error | MessageBubble, live region | Chat |
| MessageBubble | Display user/assistant content | message, role, streaming, source actions | user, assistant, streaming, partial, failed | renderer, memory link | Chat |
| Composer | Collect and send chat input | value, send, disabled, loading, mode info | empty, typing, submitting, blocked, error | textarea, button | Chat and future contextual prompts |
| MemoryRecallBar | Explain memories used by response | memories, count, open detail | hidden, none, found, expanded | status, MemoryDetail | Chat |
| MemoryHome | Memory overview | insights, recent items, search callbacks | first-use, loading, populated, empty | cards, search | Memory |
| MemoryCard | Summarize remembered item | item, source, relevance, select | default, selected, unavailable | chips, status | Memory lists and recall panel |
| MemoryDetail | Show provenance and explanation | item, source navigation, close/back | loading, available, source unavailable | drawer/page, links | Memory and Chat |
| InsightSummary | Show topics/entities/tags and counts | insight data, expand | compact, expanded, empty | chips, cards | Memory and analytics |
| BackupCenter | Backup overview and actions | quota, snapshot status, policy, actions | setup-needed, idle, queued, processing, success, error, full | backup cards, queue | Backup |
| StorageMeter | Communicate quota usage | used, total, percentage, status | normal, attention, full, unavailable | progressbar, status | Backup and Settings |
| BackupPolicyControl | Select existing storage policy | value, options, change | selected, disabled, explanation open | select/radio group | Backup and Settings |
| PassphraseField | Capture protected passphrase | value, change, visibility policy, help | empty, filled, invalid, focused | input, warning | Backup, restore, onboarding |
| QueueStatusSummary | Show upload queue health | pending, uploading, failed, last upload, retry | idle, pending, uploading, failed, success | status, retry | Backup and global status |
| QueueActivity | Detailed queue list | items/status, retry/cancel if supported | empty, active, failed, complete | list, status | Backup |
| RestoreFlow | Guide latest snapshot restoration | snapshot info, passphrase state, confirm, result | ready, confirming, working, cancelled, restored, failed | stepper, dialog, live region | Backup |
| EncryptionExplainer | Explain encryption accurately | short/long variant, link | collapsed, expanded | disclosure | Backup, Privacy, onboarding |
| SettingsShell | Settings section navigation | active section, summaries, select | desktop, mobile, advanced collapsed | navigation, PageHeader | Settings |
| SettingRow | Consistent labeled setting | label, explanation, control, status | default, changed, disabled, error | form primitives | all settings |
| AiSettingsSection | Free/BYOK/model configuration | existing API settings and callbacks | free, BYOK, validating, connected, invalid | mode selector, key field | Settings/onboarding |
| MemorySettingsSection | Memory presentation preferences | existing memory controls | default, changed, advanced | SettingRow | Settings |
| BackupSettingsSection | Backup links/preferences | existing snapshot controls/status | default, configured, attention | status, links | Settings |
| PrivacySettingsSection | Privacy choices/explanations | existing privacy controls | default, warning, confirmed | trust components | Settings |
| AdvancedSettingsSection | Progressive disclosure of advanced controls | existing advanced actions | collapsed, expanded, confirming | disclosure, ConfirmDialog | Settings |
| TrustNotice | Contextual privacy warning | type, title, copy, action | informational, warning, irreversible | status icon | all sensitive flows |
| HelpPanel | Explain product behavior | topic, open/close | closed, open | drawer/dialog, content | onboarding and Settings |
| Toast/LiveStatus | Announce non-blocking outcomes | message, severity, duration/live behavior | queued, visible, dismissed | live region | all async flows |
| ThemeControl | Select light/dark/system | value, change | light, dark, system | theme state | Settings/global utility |

### Component contract rules

- Components consume existing domain data and callbacks; they do not create replacement retrieval, snapshot, encryption, analytics, or API logic.
- Every asynchronous component defines visible, accessible states before implementation begins.
- Prefer composition of shared primitives over one-off dashboard markup.
- Destructive actions always use the shared confirmation pattern.

## 11.11 Implementation Order

Developers must implement in this order to minimize rework and preserve current behavior:

1. **Foundations** — approve content terminology; define semantic color/theme, type, spacing, radius, elevation, icon, status, motion, focus, and responsive tokens; establish shared primitives and accessibility behavior.
2. **Layout** — create the app shell, page container, responsive breakpoints, surface hierarchy, drawer/dialog conventions, safe-area handling, and global status/live-region slots.
3. **Navigation** — add primary navigation for Chat/Memory/Backup/Settings, mobile drawer, active states, route/deep-link rules, browser history, and state preservation. Map every existing sidebar action before removing or hiding anything.
4. **Chat** — migrate conversation list/search, header, messages, composer, model/mode controls, memory-used indicators, streaming/loading/errors, free-limit prompt, summary/analytics affordances, and mobile behavior. Verify streaming and persistence first.
5. **Memory** — build Memory Home, search/results, cards, detail/source navigation, insights, and Chat recall links. Verify that presentation uses existing retrieval/index results unchanged.
6. **Backup** — build Backup Center, storage meter, policy, passphrase UX, status/queue, manual backup, Arweave explanation, quota dialog, and restore flow. Verify each state against existing snapshot/queue/restore outputs and test irreversible warnings.
7. **Settings** — implement Settings shell and AI, Memory, Backups, Privacy, and Advanced sections; move existing controls without duplicating or changing behavior; preserve onboarding reset and BYOK validation.
8. **Polish** — complete empty/error/success copy, responsive refinement, keyboard/focus/live-region behavior, theme contrast, reduced motion, loading skeletons, analytics/help placement, visual QA, and regression testing.

### Release gates

- **Gate A — Architecture:** sitemap, capability matrix, and state map approved.
- **Gate B — Foundations:** themes, primitives, accessibility baseline, and responsive shell approved.
- **Gate C — Core workflow:** Chat works with streaming, Free/BYOK, persistence, summaries, and memory indicators unchanged.
- **Gate D — Trust workflows:** Memory, Backup, restore, encryption explanations, quota, and queue states reviewed with product/security.
- **Gate E — Readiness:** keyboard/screen-reader review, mobile device review, visual regression, and full existing test suite pass.

## Out of scope and change-control rule

Any request to alter API contracts, retrieval ranking, memory creation/scoring, snapshot contents, encryption, deduplication, queue processing, restore semantics, quota calculation, analytics collection, or onboarding business logic is a separate engineering phase. Phase 11 may only change presentation, navigation, copy, interaction choreography, and accessibility around those existing behaviors.