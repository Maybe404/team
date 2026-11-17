/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// types
import type { TPageNavigationTabs } from "@plane/types";
// components
import { ListLayout } from "@/components/core/list";
// plane web hooks
import type { EPageStoreType } from "@/hooks/store";
import { usePageStore } from "@/hooks/store";
// local imports
import { PageListBlock } from "./block";

type TPagesListRoot = {
  pageType: TPageNavigationTabs;
  storeType: EPageStoreType;
};

export const PagesListRoot = observer(function PagesListRoot(props: TPagesListRoot) {
  const { pageType, storeType } = props;
  // store hooks
  const { getCurrentProjectFilteredPageIdsByTab, getPageById } = usePageStore(storeType);
  // [team 二开] 折叠起来的页面；默认全部展开
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // derived values
  const filteredPageIds = getCurrentProjectFilteredPageIdsByTab(pageType);

  if (!filteredPageIds) return <></>;

  // [team 二开] 按父页面组成树：父页面不在当前列表里（比如在另一个标签、被搜索过滤掉）的当作顶层
  const idSet = new Set(filteredPageIds);
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  filteredPageIds.forEach((id) => {
    const parent = getPageById(id)?.parent;
    if (parent && parent !== id && idSet.has(parent)) children.set(parent, [...(children.get(parent) ?? []), id]);
    else roots.push(id);
  });
  const rows: { id: string; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ id, depth });
    if (!collapsed.has(id)) (children.get(id) ?? []).forEach((c) => walk(c, depth + 1));
  };
  roots.forEach((id) => walk(id, 0));

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ListLayout>
      {rows.map(({ id, depth }) => (
        <PageListBlock
          key={id}
          pageId={id}
          storeType={storeType}
          depth={depth}
          childCount={children.get(id)?.length ?? 0}
          expanded={!collapsed.has(id)}
          onToggle={() => toggle(id)}
        />
      ))}
    </ListLayout>
  );
});
