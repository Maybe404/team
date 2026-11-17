// [team 二开] 在某篇文档下面新建子页面：子页面默认跟父页面的公开/私有一致，建好后直接打开。
import { useCallback } from "react";
import { useParams } from "next/navigation";
import { setToast } from "@plane/blocks/toast";
import type { EPageStoreType } from "@/hooks/store";
import { usePageStore } from "@/hooks/store";
import { useAppRouter } from "@/hooks/use-app-router";
import type { TPageInstance } from "@/store/pages/base-page";

export const useCreateSubpage = (storeType: EPageStoreType) => {
  const { createPage } = usePageStore(storeType);
  const router = useAppRouter();
  const { workspaceSlug, projectId } = useParams();
  return useCallback(
    async (parent: Pick<TPageInstance, "id" | "access">) => {
      if (!workspaceSlug || !projectId || !parent.id) return;
      try {
        const page = await createPage({ name: "", access: parent.access, parent: parent.id });
        if (page?.id) router.push(`/${workspaceSlug}/projects/${projectId}/pages/${page.id}`);
      } catch {
        setToast({ type: "error", title: "新建失败", message: "没能新建子页面，请稍后再试。" });
      }
    },
    [createPage, projectId, router, workspaceSlug]
  );
};
