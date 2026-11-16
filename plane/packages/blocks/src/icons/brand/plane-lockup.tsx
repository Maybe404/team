/**
 * [team 二开] Loom 品牌图标：一团线绕成的线团，一缕线头飘出来，黑白两色，跟随文字颜色。
 */

import * as React from "react";

export type PlaneLockupProps = React.ComponentPropsWithoutRef<"svg">;

export function PlaneLockup({ width = "132", height = "52", className, color = "currentColor" }: PlaneLockupProps) {
  return (
    <svg width={width} height={height} viewBox="0 0 132 52" xmlns="http://www.w3.org/2000/svg" className={className} style={color !== "currentColor" ? { color } : undefined}>
      <g transform="scale(0.8125)">
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(0.0 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(25.7 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(51.4 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(77.1 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(102.9 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(128.6 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(154.3 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<path d="M44.5 43.5 C50 49 53 54 58 53 C62 52 61.5 46.5 57.5 47.5 C54 48.5 56 54 61 56" fill="none" stroke="currentColor" strokeWidth="2.21" strokeLinecap="round"/>
      </g>
      <text x="58" y="36" fill="currentColor" fontSize="30" fontWeight="700" letterSpacing="-0.5" fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif">
        Loom
      </text>
    </svg>
  );
}
