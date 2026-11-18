/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import type { TDescriptionVersionDetails, TDescriptionVersionsListResponse } from "@plane/types";
import { cn } from "@plane/utils";

// local imports
import { DescriptionVersionsDropdown } from "./dropdown";
import { DescriptionVersionsModal } from "./modal";
import { SaveSnapshotButton } from "./save-snapshot";

export type TDescriptionVersionManage = {
  getCurrentHtml: () => string | undefined;
  saveSnapshot: (label: string) => Promise<unknown>;
  setLock: (versionId: string, locked: boolean) => Promise<unknown>;
  rename: (versionId: string, label: string) => Promise<unknown>;
};

export type TDescriptionVersionEntityInformation = {
  createdAt: Date;
  createdByDisplayName: string;
  id: string;
  isRestoreDisabled: boolean;
};

type Props = {
  className?: string;
  entityInformation: TDescriptionVersionEntityInformation;
  fetchHandlers: {
    listDescriptionVersions: (entityId: string) => Promise<TDescriptionVersionsListResponse>;
    retrieveDescriptionVersion: (entityId: string, versionId: string) => Promise<TDescriptionVersionDetails>;
  };
  handleRestore: (descriptionHTML: string) => void;
  /** [team 二开] 有编辑权限时传入：保存快照、命名、锁定、和当前内容对比 */
  manage?: TDescriptionVersionManage;
  projectId?: string;
  workspaceSlug: string;
};

export const DescriptionVersionsRoot = observer(function DescriptionVersionsRoot(props: Props) {
  const { className, entityInformation, fetchHandlers, handleRestore, manage, projectId, workspaceSlug } = props;
  // states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  // derived values
  const entityId = entityInformation.id;
  // fetch versions list
  const { data: versionsListResponse, mutate: mutateList } = useSWR(
    entityId ? `DESCRIPTION_VERSIONS_LIST_${entityId}` : null,
    entityId ? () => fetchHandlers.listDescriptionVersions(entityId) : null
  );
  // fetch active version details
  const { data: activeVersionResponse } = useSWR(
    entityId && activeVersionId ? `DESCRIPTION_VERSION_DETAILS_${activeVersionId}` : null,
    entityId && activeVersionId ? () => fetchHandlers.retrieveDescriptionVersion(entityId, activeVersionId) : null
  );
  const versions = Array.isArray(versionsListResponse?.results) ? versionsListResponse.results : undefined;
  const versionsCount = versions?.length ?? 0;
  const activeVersionDetails = versions?.find((version) => version.id === activeVersionId);
  const activeVersionIndex = versions?.findIndex((version) => version.id === activeVersionId);
  const activeVersionDescription = activeVersionResponse
    ? (activeVersionResponse.description_html ?? "<p></p>")
    : undefined;

  const handleNavigation = useCallback(
    (direction: "prev" | "next") => {
      if (activeVersionIndex === undefined) return;
      if (direction === "prev" && activeVersionIndex > 0) {
        setActiveVersionId(versions?.[activeVersionIndex - 1].id ?? null);
      } else if (direction === "next" && activeVersionIndex < versionsCount - 1) {
        setActiveVersionId(versions?.[activeVersionIndex + 1].id ?? null);
      }
    },
    [activeVersionIndex, versions, versionsCount]
  );

  return (
    <>
      <DescriptionVersionsModal
        activeVersionDescription={activeVersionDescription}
        activeVersionDetails={activeVersionDetails}
        handleClose={() => {
          setIsModalOpen(false);
          setTimeout(() => {
            setActiveVersionId(null);
          }, 300);
        }}
        handleNavigation={handleNavigation}
        handleRestore={handleRestore}
        manage={manage}
        onChanged={() => void mutateList()}
        isNextDisabled={activeVersionIndex === versionsCount - 1}
        isOpen={isModalOpen}
        isPrevDisabled={activeVersionIndex === 0}
        isRestoreDisabled={entityInformation.isRestoreDisabled}
        projectId={projectId}
        workspaceSlug={workspaceSlug}
      />
      <div className={cn(className, manage && "flex items-center gap-2")}>
        {manage && <SaveSnapshotButton manage={manage} onSaved={() => void mutateList()} />}
        <DescriptionVersionsDropdown
          disabled={versionsCount === 0}
          entityInformation={entityInformation}
          onVersionClick={(versionId) => {
            setIsModalOpen(true);
            setActiveVersionId(versionId);
          }}
          versions={versions}
        />
      </div>
    </>
  );
});
