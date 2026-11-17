// [team 二开] 文档右侧的「层级」：从最上层的页面往下展示整棵树，当前页面高亮，点一下跳转，可以在当前页面下新建子页面。
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ChevronRightOutline, PagesOutline, PlusCircleOutline } from "@makeplane/propel/icons";
import { ScrollArea } from "@makeplane/propel/components/scroll-area";
import { EPageStoreType, usePageStore } from "@/hooks/store";
import { useCreateSubpage } from "@/hooks/use-create-subpage";
import type { TPageInstance } from "@/store/pages/base-page";

type Props = { page: TPageInstance };

export const PageNavigationPaneHierarchyTabPanel = observer(function PageNavigationPaneHierarchyTabPanel({ page }: Props) {
  const { workspaceSlug, projectId } = useParams();
  const { getPageById, getCurrentProjectPageIds } = usePageStore(EPageStoreType.PROJECT);
  const createSubpage = useCreateSubpage(EPageStoreType.PROJECT);

  const all = (projectId ? getCurrentProjectPageIds(projectId.toString()) : []).map((id) => getPageById(id)).filter(
    (p): p is NonNullable<ReturnType<typeof getPageById>> => !!p && !p.archived_at
  );
  const childrenOf = (id: string | undefined) => all.filter((p) => p.parent === id);

  // 往上找到最上层的页面
  const chain: string[] = [];
  let cur: string | null | undefined = page.id;
  while (cur && !chain.includes(cur)) {
    chain.push(cur);
    cur = getPageById(cur)?.parent;
  }
  const rootId = chain[chain.length - 1];
  const ancestors = chain.slice(1).reverse();

  const link = (id: string | undefined) => `/${workspaceSlug}/projects/${projectId}/pages/${id}`;
  const label = (p: { name?: string }) => p.name?.trim() || "无标题";

  const Node = ({ id, depth }: { id: string; depth: number }) => {
    const p = getPageById(id);
    if (!p) return null;
    const kids = childrenOf(id);
    const here = id === page.id;
    return (
      <>
        <a
          href={link(id)}
          className={`flex items-center gap-1.5 rounded px-2 py-1 text-body-sm-regular hover:bg-layer-transparent-hover ${here ? "bg-layer-transparent-hover font-medium text-primary" : "text-secondary"}`}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <PagesOutline className="size-3.5 shrink-0 text-tertiary" />
          <span className="truncate">{label(p)}</span>
        </a>
        {kids.map((k) => (
          <Node key={k.id} id={k.id!} depth={depth + 1} />
        ))}
      </>
    );
  };

  return (
    <ScrollArea orientation="vertical" visibility="auto" size="sm">
      <div className="flex flex-col gap-2 px-3.5 py-1">
        {ancestors.length > 0 && (
          <div className="flex flex-wrap items-center gap-0.5 text-caption-md-regular text-tertiary">
            {ancestors.map((id) => (
              <span key={id} className="flex items-center gap-0.5">
                <a href={link(id)} className="max-w-32 truncate hover:text-primary hover:underline">
                  {label(getPageById(id) ?? {})}
                </a>
                <ChevronRightOutline className="size-3" />
              </span>
            ))}
            <span className="text-secondary">{label(page)}</span>
          </div>
        )}
        <div className="flex flex-col">{rootId && <Node id={rootId} depth={0} />}</div>
        {!page.archived_at && (
          <button
            type="button"
            onClick={() => void createSubpage(page)}
            className="flex items-center gap-1.5 self-start rounded px-2 py-1 text-body-sm-regular text-tertiary hover:bg-layer-transparent-hover hover:text-primary"
          >
            <PlusCircleOutline className="size-3.5" />
            在当前页面下新建子页面
          </button>
        )}
      </div>
    </ScrollArea>
  );
});
