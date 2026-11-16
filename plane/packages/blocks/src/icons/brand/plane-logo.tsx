/**
 * [team 二开] 织机 Loom 品牌图标：圆角方块里经纬交织的平纹，象征任务、文档、经验织在一起。
 */

import * as React from "react";

export type PlaneLogoProps = React.ComponentPropsWithoutRef<"svg">;

// 组件名沿用上游，免得改动所有调用处；color 是底色，默认品牌蓝
export function PlaneLogo({ width = "52", height = "52", className, color = "#3F76FF" }: PlaneLogoProps) {
  const TILE = color === "currentColor" ? "#3F76FF" : color;
  return (
    <svg width={width} height={height} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="64" height="64" rx="15" fill={TILE} />
      <g>
<line x1="9" y1="17" x2="55" y2="17" stroke="#fff" strokeWidth="7.0" strokeLinecap="round"/>
<line x1="9" y1="32" x2="55" y2="32" stroke="#fff" strokeWidth="7.0" strokeLinecap="round"/>
<line x1="9" y1="47" x2="55" y2="47" stroke="#fff" strokeWidth="7.0" strokeLinecap="round"/>
<line x1="17" y1="9" x2="17" y2="55" stroke="#fff" strokeWidth="7.0" strokeLinecap="round"/>
<line x1="32" y1="9" x2="32" y2="55" stroke="#fff" strokeWidth="7.0" strokeLinecap="round"/>
<line x1="47" y1="9" x2="47" y2="55" stroke="#fff" strokeWidth="7.0" strokeLinecap="round"/>
<rect x="11.3" y="11.3" width="11.4" height="11.4" fill={TILE}/>
<line x1="17" y1="10.8" x2="17" y2="23.2" stroke="#fff" strokeWidth="7.0"/>
<rect x="11.3" y="26.3" width="11.4" height="11.4" fill={TILE}/>
<line x1="10.8" y1="32" x2="23.2" y2="32" stroke="#fff" strokeWidth="7.0"/>
<rect x="11.3" y="41.3" width="11.4" height="11.4" fill={TILE}/>
<line x1="17" y1="40.8" x2="17" y2="53.2" stroke="#fff" strokeWidth="7.0"/>
<rect x="26.3" y="11.3" width="11.4" height="11.4" fill={TILE}/>
<line x1="25.8" y1="17" x2="38.2" y2="17" stroke="#fff" strokeWidth="7.0"/>
<rect x="26.3" y="26.3" width="11.4" height="11.4" fill={TILE}/>
<line x1="32" y1="25.8" x2="32" y2="38.2" stroke="#fff" strokeWidth="7.0"/>
<rect x="26.3" y="41.3" width="11.4" height="11.4" fill={TILE}/>
<line x1="25.8" y1="47" x2="38.2" y2="47" stroke="#fff" strokeWidth="7.0"/>
<rect x="41.3" y="11.3" width="11.4" height="11.4" fill={TILE}/>
<line x1="47" y1="10.8" x2="47" y2="23.2" stroke="#fff" strokeWidth="7.0"/>
<rect x="41.3" y="26.3" width="11.4" height="11.4" fill={TILE}/>
<line x1="40.8" y1="32" x2="53.2" y2="32" stroke="#fff" strokeWidth="7.0"/>
<rect x="41.3" y="41.3" width="11.4" height="11.4" fill={TILE}/>
<line x1="47" y1="40.8" x2="47" y2="53.2" stroke="#fff" strokeWidth="7.0"/>
      </g>
    </svg>
  );
}
