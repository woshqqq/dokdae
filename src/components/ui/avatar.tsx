import { cn } from "./cn";

const palette = ["#f4d7c5", "#d9e7d1", "#d6e2f2", "#efe0b8", "#e7d5ec", "#d3ece8"];

function hash(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** 기본 아바타: 닉네임 첫 글자 + 사용자 ID 기반 배경색 */
export function Avatar({ seed, name, size = "md" }: { seed: string; name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: palette[hash(seed) % palette.length] }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-ink/80",
        size === "sm" && "size-8 text-sm",
        size === "md" && "size-10 text-base",
        size === "lg" && "size-16 text-2xl",
      )}
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );
}
