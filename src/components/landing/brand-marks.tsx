type MarkProps = { className?: string };

function Mark({ className, children }: MarkProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

export function OpenAIMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M22.1 10.2a5.2 5.2 0 0 0-.5-4.4 5.3 5.3 0 0 0-6.2-2.3A5.3 5.3 0 0 0 11 1a5.3 5.3 0 0 0-5 3.4 5.2 5.2 0 0 0-4 4.8 5.3 5.3 0 0 0 .5 4.6 5.3 5.3 0 0 0 6.2 2.3A5.3 5.3 0 0 0 13 23a5.3 5.3 0 0 0 5-3.4 5.2 5.2 0 0 0 4.1-4.8 5.3 5.3 0 0 0 0-.6zM11.6 3.6a3.4 3.4 0 0 1 3.1 2l-4.2 2.4a.6.6 0 0 1-.8-.2L8 5.7a3.4 3.4 0 0 1 3.6-2.1zm-6.4 5a3.3 3.3 0 0 1 1.7-2.2l1.7 2.1c.2.3.2.7 0 1L6.2 13a3.4 3.4 0 0 1-.9-4.4zm2.4 8.7 1.8-1a.6.6 0 0 1 .8.2l2.4 4.1a3.4 3.4 0 0 1-5-3.3zm8.2 3.1a3.4 3.4 0 0 1-3.1-1.8l4.2-2.4a.6.6 0 0 1 .8.2l1.7 2.1a3.4 3.4 0 0 1-3.6 1.9zm3.2-3.5-1.8 1a.6.6 0 0 1-.8-.2l-2.4-4.1a3.4 3.4 0 0 1 5-.1 3.3 3.3 0 0 1 0 3.4zm1.6-4.3-2.4 1.4a.6.6 0 0 1-.8-.2l-2.4-4.1a3.4 3.4 0 0 1 5 .1c.5.9.6 1.9.6 2.8z" />
    </Mark>
  );
}

export function ClaudeMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M16.7 4.2c-.7 1.6-2.3 4.8-3.3 6.6L9.6 17c-.5.9-1 1.3-1.8 1.3-.6 0-1-.3-1.2-.9-.2-.5 0-1.1.5-2l4.6-8.7c.8-1.5 2.1-3.7 2.8-4.3.5-.4 1.1-.3 1.5.2.3.4.5 1 .7 1.6zm-5.4 8.4 2.4-4.5c.8 1.6 3.1 6.2 3.5 7.3.4 1.1.2 2.1-.6 2.7-.7.5-1.5.4-2.3-.5l-3-4.9zM8.2 6.4c.8 0 1.4.5 1.7 1.3l2.2 4.6-2.5 4.6c-.4.7-1.2 1.1-2 .8-.8-.3-1.2-1.1-.9-1.9l2.1-3.8-1.8-3.7c-.3-.7-.2-1.4.4-1.8.2 0 .5-.1.8-.1z" />
    </Mark>
  );
}

export function GeminiMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M12 1.5c.4 4.3 2.2 7.6 5.4 9.5-3.2 1.9-5 5.2-5.4 9.5-.4-4.3-2.2-7.6-5.4-9.5C9.8 9.1 11.6 5.8 12 1.5z" />
    </Mark>
  );
}

export function DeepSeekMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M12 2 4 7v10l8 5 8-5V7l-8-5zm0 2.3 5.7 3.5L12 11.3 6.3 7.8 12 4.3zM6 9.2l5 3.1v6.2l-5-3.1V9.2zm7 9.3v-6.2l5-3.1v6.2l-5 3.1z" />
    </Mark>
  );
}

export function QwenMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M12 2a10 10 0 1 0 .01 20.01A10 10 0 0 0 12 2zm-1.2 5.2h2.4v3.2h3.2v2.4h-3.2v3.6h-2.4v-3.6H7.6V10.4h3.2V7.2z" />
    </Mark>
  );
}

export function GrokMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M4 4h3.2l4.1 6.3L15.6 4H19l-5.6 7.7L19.2 20H16l-4.4-6.7L7.2 20H4l5.8-8.3L4 4z" />
    </Mark>
  );
}

export function KimiMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M5 4h3.1l3.9 9.2L16 4h3L13.6 20h-3.2L5 4z" />
    </Mark>
  );
}

export function GroqMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M4 6h7.2a4 4 0 0 1 0 8H8v4H4V6zm4 4.5h2.8a1.5 1.5 0 0 0 0-3H8v3zM14 10h6v2.2h-3.6V18H14v-8z" />
    </Mark>
  );
}

export function OpenRouterMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M4 7h10.2a3.2 3.2 0 0 1 0 6.4H8.8V17H5.2v-6.4H4V7zm4.8 2.2v1.9h4.7a1 1 0 0 0 0-1.9H8.8zM14 14.2h6v2.2h-6v-2.2z" />
    </Mark>
  );
}

export function MetaMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M7.2 6.2c2 .1 3.4 1.4 4.8 3.6 1.4-2.2 2.8-3.5 4.8-3.6 2.3-.1 4.2 1.8 4.2 4.6 0 3.8-3.4 7.2-9 7.2S3 14.6 3 10.8c0-2.8 1.9-4.7 4.2-4.6zm4.8 4.1C10.6 8.2 9.4 7.4 8 7.5 6.6 7.6 5.4 8.8 5.4 10.6c0 2.4 2.2 4.6 6.6 4.6s6.6-2.2 6.6-4.6c0-1.8-1.2-3-2.6-3.1-1.4-.1-2.6.7-4 2.8z" />
    </Mark>
  );
}

export function ArweaveMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M12 1.8 20.5 6.7v10.6L12 22.2 3.5 17.3V6.7L12 1.8zm0 2.5L6 7.8v8.4l6 3.5 6-3.5V7.8l-6-3.5zM9.1 9.2h5.8v1.7h-2v4.9h-1.8v-4.9h-2V9.2z" />
    </Mark>
  );
}

export function CursorMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M5 3.5 18.8 11 12 13.2 9.6 20.2 5 3.5zm3.1 3.1 2.1 7.6 1.2-3.4 3.5-1.1-6.8-3.1z" />
    </Mark>
  );
}

export function CodexMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M4 5h16v3h-6.2v11h-3.6V8H4V5z" />
    </Mark>
  );
}
