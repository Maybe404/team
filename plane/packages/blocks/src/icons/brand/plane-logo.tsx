/**
 * [team 二开] Loom 品牌图标：一团线绕成的线团，一缕线头飘出来，黑白两色，跟随文字颜色。
 */

import * as React from "react";

export type PlaneLogoProps = React.ComponentPropsWithoutRef<"svg">;

// 组件名沿用上游，免得改动所有调用处；颜色用 currentColor，亮色黑、暗色白
export function PlaneLogo({ width = "52", height = "52", className, color = "currentColor" }: PlaneLogoProps) {
  return (
    <svg width={width} height={height} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" className={className} style={color !== "currentColor" ? { color } : undefined}>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(0.0 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(25.7 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(51.4 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(77.1 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(102.9 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(128.6 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<ellipse cx="29" cy="29" rx="20" ry="11" transform="rotate(154.3 29 29)" fill="none" stroke="currentColor" strokeWidth="1.7"/>
<path d="M44.5 43.5 C50 49 53 54 58 53 C62 52 61.5 46.5 57.5 47.5 C54 48.5 56 54 61 56" fill="none" stroke="currentColor" strokeWidth="2.21" strokeLinecap="round"/>
    </svg>
  );
}
