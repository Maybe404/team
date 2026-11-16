/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { ClipboardOutline, ExportOutline, GlobeOutline, HistoryOutline, WorkItemsOutline } from "@makeplane/propel/icons";
import { useParams } from "react-router";
// plane imports
import { setToast } from "@plane/blocks/toast";
import { Switch } from "@makeplane/propel/components/switch";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
import { usePageFilters } from "@/hooks/use-page-filters";
import { useQueryParams } from "@/hooks/use-query-params";
// plane web imports
import type { TPageNavigationPaneTab } from "@/components/pages/navigation-pane/tab-panels";
import type { EPageStoreType } from "@/hooks/store";
// store
import type { TPageInstance } from "@/store/pages/base-page";
// local imports
import { PageActions } from "../../dropdowns";
import { ExportPageModal } from "../../modals/export-page-modal";
import { TeamPageShareModal } from "../../modals/team-share-modal";
import { TeamPageIssuesModal } from "@/components/team/page-issue-links";
import { PAGE_NAVIGATION_PANE_TABS_QUERY_PARAM } from "../../navigation-pane";

type Props = {
  page: TPageInstance;
  storeType: EPageStoreType;
};

export const PageOptionsDropdown = observer(function PageOptionsDropdown(props: Props) {
  const { page, storeType } = props;
  // states
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isLinkIssuesOpen, setIsLinkIssuesOpen] = useState(false);
  const { workspaceSlug, projectId } = useParams();
  // navigation
  const router = useAppRouter();
  // store values
  const {
    name,
    isContentEditable,
    editor: { editorRef },
  } = page;
  // page filters
  const { isFullWidth, handleFullWidth, isStickyToolbarEnabled, handleStickyToolbar } = usePageFilters();
  // query params
  const { updateQueryParams } = useQueryParams();
  // menu items list
  const EXTRA_MENU_OPTIONS = useMemo(
    function EXTRA_MENU_OPTIONS(): React.ComponentProps<typeof PageActions>["extraOptions"] {
      return [
        {
          key: "full-screen",
          action: () => handleFullWidth(!isFullWidth),
          title: "Full width",
          // The row itself does the toggling; the switch is the state readout at the row's end.
          customContent: (
            <span className="pointer-events-none">
              <Switch size="sm" checked={isFullWidth} aria-hidden tabIndex={-1} />
            </span>
          ),
        },
        {
          key: "sticky-toolbar",
          action: () => handleStickyToolbar(!isStickyToolbarEnabled),
          title: "Sticky toolbar",
          customContent: (
            <span className="pointer-events-none">
              <Switch size="sm" checked={isStickyToolbarEnabled} aria-hidden tabIndex={-1} />
            </span>
          ),
          shouldRender: isContentEditable,
        },
        {
          key: "copy-markdown",
          action: () => {
            if (!editorRef) return;
            editorRef.copyMarkdownToClipboard();
            setToast({
              type: "success",
              title: "Success!",
              message: "Markdown copied to clipboard.",
            });
          },
          title: "Copy markdown",
          icon: ClipboardOutline,
          shouldRender: true,
        },
        {
          key: "version-history",
          action: () => {
            // update query param to show the version history in navigation pane
            const updatedRoute = updateQueryParams({
              paramsToAdd: {
                [PAGE_NAVIGATION_PANE_TABS_QUERY_PARAM]: "version_history" satisfies TPageNavigationPaneTab,
              },
            });
            router.push(updatedRoute);
          },
          title: "Version history",
          icon: HistoryOutline,
          shouldRender: true,
        },
        {
          // [team 二开] 文档公开只读链接
          key: "team-public-link",
          action: () => setIsShareModalOpen(true),
          title: "公开链接",
          icon: GlobeOutline,
          shouldRender: !page.archived_at,
        },
        {
          // [team 二开] 文档 ↔ 工作项一键关联
          key: "team-link-issues",
          action: () => setIsLinkIssuesOpen(true),
          title: "关联工作项",
          icon: WorkItemsOutline,
          shouldRender: !page.archived_at,
        },
        {
          key: "export",
          action: () => setIsExportModalOpen(true),
          title: "Export",
          icon: ExportOutline,
          shouldRender: true,
        },
      ];
    },
    [
      handleFullWidth,
      isFullWidth,
      handleStickyToolbar,
      isStickyToolbarEnabled,
      isContentEditable,
      editorRef,
      updateQueryParams,
      router,
      setIsExportModalOpen,
      setIsLinkIssuesOpen,
      page.archived_at,
    ]
  );

  return (
    <>
      <ExportPageModal
        editorRef={editorRef}
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        pageTitle={name ?? ""}
      />
      <TeamPageIssuesModal
        isOpen={isLinkIssuesOpen}
        onClose={() => setIsLinkIssuesOpen(false)}
        workspaceSlug={String(workspaceSlug ?? "")}
        projectId={String(projectId ?? "")}
        pageId={page.id ?? ""}
      />
      <TeamPageShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        pageId={page.id ?? ""}
        isPrivate={page.access === 1}
      />
      <PageActions
        extraOptions={EXTRA_MENU_OPTIONS}
        optionsOrder={[
          "full-screen",
          "sticky-toolbar",
          "copy-markdown",
          "version-history",
          "make-a-copy",
          "archive-restore",
          "delete",
          "toggle-access",
          "export",
          "team-link-issues",
          "team-public-link",
        ]}
        page={page}
        storeType={storeType}
      />
    </>
  );
});
