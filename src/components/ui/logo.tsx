import { cn } from "@/lib/utils";

/** The exact, transparent logo supplied for the PermaMind app. */
const LOGO_SRC = "/permamind-logo.png";

/** Pixel sizes used for the mark across the app. */
type LogoSize = "xs" | "sm" | "md" | "lg";

const sizeMap: Record<LogoSize, { width: number; height: number }> = {
  xs: { width: 112, height: 61 },
  sm: { width: 150, height: 81 },
  md: { width: 190, height: 103 },
  lg: { width: 250, height: 135 },
};

interface LogoMarkProps {
  size?: LogoSize;
  className?: string;
  framed?: boolean;
  ariaLabel?: string;
}

/**
 * Kept as a backwards-compatible component name. It renders the supplied
 * logo unchanged; no crop, filter, frame, or replacement mark is applied.
 */
export function LogoMark({
  size = "md",
  className,
  framed = false,
  ariaLabel = "PermaMind",
}: LogoMarkProps) {
  void framed;
  const dims = sizeMap[size];

  return (
    <img
      src={LOGO_SRC}
      alt={ariaLabel}
      width={dims.width}
      height={dims.height}
      className={cn("h-auto shrink-0 object-contain", className)}
      role="img"
    />
  );
}

interface LogoPlanetProps {
  size?: number;
  className?: string;
  ariaLabel?: string;
  decorative?: boolean;
  style?: React.CSSProperties;
}

/**
 * Backwards-compatible wrapper used by the splash screen. The full supplied
 * logo is kept intact and scaled proportionally.
 */
export function LogoPlanet({
  size = 24,
  className,
  ariaLabel = "PermaMind",
  decorative = false,
  style,
}: LogoPlanetProps) {
  return (
    <img
      src={LOGO_SRC}
      alt={decorative ? "" : ariaLabel}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? "true" : undefined}
      width={Math.round(size * 2173 / 1175)}
      height={size}
      className={cn("h-auto shrink-0 object-contain", className)}
      style={style}
    />
  );
}

interface LogoProps {
  size?: LogoSize;
  className?: string;
  withWordmark?: boolean;
  framed?: boolean;
}

/**
 * The full supplied brand lockup. The legacy props are retained so existing
 * call sites continue to compile.
 */
export function Logo({
  size = "md",
  className,
  withWordmark = true,
  framed = true,
}: LogoProps) {
  void withWordmark;
  void framed;
  // Keep the existing API for call sites while always rendering the exact
  return <LogoMark size={size} className={className} />;
}
