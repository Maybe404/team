/**
 * [team 二开] 织机 Loom 品牌图标：圆角方块里经纬交织的平纹，象征任务、文档、经验织在一起。
 */

import * as React from "react";

export type PlaneLockupProps = React.ComponentPropsWithoutRef<"svg">;

export function PlaneLockup({ width = "180", height = "52", className, color = "currentColor" }: PlaneLockupProps) {
  const TILE = "#3F76FF";
  return (
    <svg width={width} height={height} viewBox="0 0 180 52" xmlns="http://www.w3.org/2000/svg" className={className}>
      <g transform="scale(0.8125)">
        <rect width="64" height="64" rx="15" fill={TILE} />
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
      <text x="62" y="35" fill={color} fontSize="26" fontWeight="700" fontFamily="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">
        织机 Loom
      </text>
    </svg>
  );
}
