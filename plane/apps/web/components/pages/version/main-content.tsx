/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ShowOutline } from "@makeplane/propel/icons";
// plane imports
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TPageVersion } from "@plane/types";
import { renderFormattedDate, renderFormattedTime } from "@plane/utils";
// helpers
import type { EPageStoreType } from "@/hooks/store";
import { ProjectPageVersionService } from "@/services/page/project-page-version.service";
// local imports
import type { TVersionEditorProps } from "./editor";

type Props = {
  activeVersion: string | null;
  editorComponent: React.FC<TVersionEditorProps>;
  fetchVersionDetails: (pageId: string, versionId: string) => Promise<TPageVersion | undefined>;
  handleClose: () => void;
  handleRestore: (descriptionHTML: string) => Promise<void>;
  pageId: string;
  restoreEnabled: boolean;
  storeType: EPageStoreType;
};

export const PageVersionsMainContent = observer(function PageVersionsMainContent(props: Props) {
  const {
    activeVersion,
    editorComponent,
    fetchVersionDetails,
    handleClose,
    handleRestore,
    pageId,
    restoreEnabled,
    storeType,
  } = props;
  // states
  const [isRestoring, setIsRestoring] = useState(false);
  // translation
  const { t } = useTranslation();
  const [isRetrying, setIsRetrying] = useState(false);

  const {
    data: versionDetails,
    error: versionDetailsError,
    mutate: mutateVersionDetails,
  } = useSWR(
    pageId && activeVersion ? `PAGE_VERSION_${activeVersion}` : null,
    pageId && activeVersion ? () => fetchVersionDetails(pageId, activeVersion) : null
  );

  // [team 二开] 恢复前先问：当前内容要不要先保存成一个版本，避免回退后找不回刚才的改动
  const [confirming, setConfirming] = useState(false);
  const { workspaceSlug, projectId } = useParams();
  const saveCurrentSnapshot = async () => {
    if (!pageId || !workspaceSlug || !projectId) return;
    await new ProjectPageVersionService().saveSnapshot(workspaceSlug.toString(), projectId.toString(), pageId, {
      label: "恢复前自动保存",
    });
  };

  const handleRestoreVersion = async (saveFirst: boolean) => {
    if (!restoreEnabled) return;
    setIsRestoring(true);
    setConfirming(false);
    if (saveFirst) {
      try {
        await saveCurrentSnapshot();
      } catch {
        setToast({ type: "error", title: "没能先保存当前内容，已取消恢复" });
        setIsRestoring(false);
        return;
      }
    }
    await handleRestore(versionDetails?.description_html ?? "<p></p>")
      .then(() => {
        setToast({
          type: "success",
          title: t("page_navigation_pane.tabs.version_history.restore_success"),
        });
        handleClose();
      })
      .catch(() =>
        setToast({
          type: "error",
          title: t("page_navigation_pane.tabs.version_history.restore_failed"),
        })
      )
      .finally(() => setIsRestoring(false));
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    await mutateVersionDetails();
    setIsRetrying(false);
  };

  const VersionEditor = editorComponent;

  return (
    <div className="flex flex-grow flex-col overflow-hidden">
      {versionDetailsError ? (
        <EmptyStateCompact
          assetKey="unknown"
          rootClassName="grow"
          title={t("common.something_went_wrong")}
          description={t("page_navigation_pane.tabs.version_history.load_error_description")}
          actions={[
            {
              label: t("page_navigation_pane.tabs.version_history.try_again"),
              variant: "secondary",
              onClick: () => void handleRetry(),
              loading: isRetrying,
            },
          ]}
        />
      ) : (
        <>
          <div className="flex min-h-14 items-center justify-between gap-2 border-y border-subtle px-5 py-3">
            <div className="flex items-center gap-4">
              <h6 className="text-body-sm-medium text-primary">
                {versionDetails
                  ? `${renderFormattedDate(versionDetails.last_saved_at)} ${renderFormattedTime(versionDetails.last_saved_at)}`
                  : t("page_navigation_pane.tabs.version_history.loading_details")}
              </h6>
              <Badge
                variant="brand"
                size="sm"
                startIcon={<Icon icon={ShowOutline} />}
                label={t("page_navigation_pane.tabs.version_history.view_only")}
              />
            </div>
            {restoreEnabled && (
              <Button
                variant="primary"
                size="sm"
                stretch="auto"
                label={
                  isRestoring ? t("page_navigation_pane.tabs.version_history.restoring") : t("common.actions.restore")
                }
                onClick={() => setConfirming(true)}
                loading={isRestoring}
              />
            )}
          </div>
          {confirming && (
            <div className="flex flex-wrap items-center gap-2 border-b border-subtle bg-layer-2 px-5 py-3 text-body-sm-regular text-primary">
              <span className="flex-1">恢复到这个版本前，要不要先把当前内容保存成一个版本？不保存的话，当前未存为版本的改动可能找不回。</span>
              <Button variant="primary" size="sm" stretch="auto" label="保存当前并恢复" onClick={() => void handleRestoreVersion(true)} />
              <Button variant="secondary" size="sm" stretch="auto" label="不保存，直接恢复" onClick={() => void handleRestoreVersion(false)} />
              <Button variant="ghost" size="sm" stretch="auto" label="取消" onClick={() => setConfirming(false)} />
            </div>
          )}
          <div className="vertical-scrollbar scrollbar-sm h-full overflow-y-scroll pt-8">
            <VersionEditor activeVersion={activeVersion} storeType={storeType} versionDetails={versionDetails} />
          </div>
        </>
      )}
    </div>
  );
});
