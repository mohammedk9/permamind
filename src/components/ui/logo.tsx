import { cn } from "@/lib/utils";

/** The exact, transparent logo supplied for the PermaMind app. */
const LOGO_SRC = "/permamind-logo.png";

/** Pixel sizes used for the mark across the app. */
type LogoSize = "xs" | "sm" | "md" | "lg";

/**
 * The supplied asset is a wide lockup, 2173x1175 (see `LogoPlanet`, which
 * already derives its width from that ratio). Sizing it by width pushed a
 * 150x81 image into a 64px header, so height is now the constrained axis and
 * the width follows the real ratio. Both attributes are still emitted so the
 * browser reserves the correct box before the image loads.
 */
const ASPECT = 2173 / 1175;

/** Rendered heights per size, as Tailwind height utilities. */
const heightMap: Record<LogoSize, { className: string; px: number }> = {
  xs: { className: "h-[30px] w-auto", px: 30 },
  sm: { className: "h-8 w-auto sm:h-9", px: 36 },
  md: { className: "h-9 w-auto sm:h-10", px: 40 },
  lg: { className: "h-14 w-auto sm:h-20", px: 56 },
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
  const height = heightMap[size];

  return (
    <img
      src={LOGO_SRC}
      alt={ariaLabel}
      width={Math.round(height.px * ASPECT)}
      height={height.px}
      className={cn(height.className, "logo-on-light shrink-0 object-contain", className)}
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
  // The lockup is nearly twice as wide as it is tall, so a `size` of 180
  // rendered 332px wide and overflowed a 320px phone. Callers on narrow
  // viewports pass a smaller `size`, and `maxWidth`/`maxHeight` keep it inside
  // the screen even before that measurement lands.
  return (
    <img
      src={LOGO_SRC}
      alt={decorative ? "" : ariaLabel}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? "true" : undefined}
      width={Math.round(size * ASPECT)}
      height={size}
      className={cn(
        "logo-on-light h-auto w-auto shrink-0 object-contain",
        "max-h-[22svh] max-w-[80vw]",
        className,
      )}
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
