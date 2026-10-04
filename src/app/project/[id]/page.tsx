import { ChatApp } from "@/components/chat/chat-app";

/**
 * `/project/<id>` — the project workspace, at an address that survives a reload.
 *
 * The workspace renders inside `ChatApp`, which restores the id from the second path segment once
 * the store has hydrated. This page exists so the route resolves at all: without it the URL 404s
 * on refresh, which is how a shared project link quietly stops working.
 */
export default function ProjectPage() {
  return <ChatApp />;
}