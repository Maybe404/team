/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef } from "react";
import { observer } from "mobx-react";
import { Logo } from "@plane/blocks/emoji-icon-picker";
import { ChevronDownOutline, ChevronRightOutline, PagesOutline } from "@makeplane/propel/icons";
// plane imports
import { getPageName } from "@plane/utils";
// components
import { ListItem } from "@/components/core/list";
import { BlockItemAction } from "@/components/pages/list/block-item-action";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web hooks
import type { EPageStoreType } from "@/hooks/store";
import { usePage } from "@/hooks/store";

type TPageListBlock = {
  pageId: string;
  storeType: EPageStoreType;
  // [team 二开] 层级：缩进深度、子页面数、是否展开
  depth?: number;
  childCount?: number;
  expanded?: boolean;
  onToggle?: () => void;
};

export const PageListBlock = observer(function PageListBlock(props: TPageListBlock) {
  const { pageId, storeType, depth = 0, childCount = 0, expanded = true, onToggle } = props;
  // refs
  const parentRef = useRef(null);
  // hooks
  const page = usePage({
    pageId,
    storeType,
  });
  const { isMobile } = usePlatformOS();
  // handle page check
  if (!page) return null;
  // derived values
  const { name, logo_props, getRedirectionLink } = page;

  return (
    <ListItem
      prependTitleElement={
        <span className="flex shrink-0 items-center gap-0.5" style={{ paddingLeft: depth * 20 }}>
          {childCount > 0 ? (
            <button
              type="button"
              title={expanded ? "收起子页面" : `展开 ${childCount} 个子页面`}
              className="grid size-5 place-items-center rounded text-tertiary hover:bg-layer-transparent-hover hover:text-primary"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggle?.();
              }}
            >
              {expanded ? <ChevronDownOutline className="size-3.5" /> : <ChevronRightOutline className="size-3.5" />}
            </button>
          ) : (
            <span className="size-5" />
          )}
          <span className="grid size-6 shrink-0 place-items-center">
            {logo_props?.in_use ? (
              <Logo logo={logo_props} size={16} type="lucide" />
            ) : (
              <PagesOutline className="size-4 text-tertiary" />
            )}
          </span>
        </span>
      }
      title={getPageName(name)}
      leftElementClassName="gap-2"
      itemLink={getRedirectionLink()}
      actionableItems={<BlockItemAction page={page} parentRef={parentRef} storeType={storeType} />}
      isMobile={isMobile}
      parentRef={parentRef}
    />
  );
});
