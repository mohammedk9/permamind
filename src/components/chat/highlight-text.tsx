interface HighlightTextProps {
  text: string;
  start: number;
  end: number;
  className?: string;
}

export function HighlightText({
  text,
  start,
  end,
  className,
}: HighlightTextProps) {
  if (start < 0 || end <= start || end > text.length) {
    return <span className={className}>{text}</span>;
  }

  const before = text.slice(0, start);
  const match = text.slice(start, end);
  const after = text.slice(end);

  return (
    <span className={className}>
      {before}
      <mark className="rounded-sm bg-primary/25 px-0.5 font-medium text-foreground">
        {match}
      </mark>
      {after}
    </span>
  );
}
