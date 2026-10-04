import { ChatApp } from "@/components/chat/chat-app";

/**
 * `/memory` — the memory surface.
 *
 * `ChatApp` reads the path itself, so this renders the right area a tick after mount. The page
 * exists so the URL is a real route and the sidebar's Memory entry lands somewhere other than a
 * 404.
 */
export default function MemoryPage() {
  return <ChatApp />;
}