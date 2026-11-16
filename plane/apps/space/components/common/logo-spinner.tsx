/**
 * [team 二开] 加载动画：Loom图标轻轻呼吸，替换上游的 gif。
 */

import { PlaneLogo } from "@plane/blocks/icons";

export function LogoSpinner() {
  return (
    <div className="flex items-center justify-center">
      <PlaneLogo width="44" height="44" className="h-6 w-6 animate-pulse sm:h-11 sm:w-11" />
    </div>
  );
}
