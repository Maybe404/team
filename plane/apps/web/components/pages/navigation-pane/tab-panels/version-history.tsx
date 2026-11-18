/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { CloseOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import type { TPageVersion } from "@plane/types";
import { cn, getFileURL, renderFormattedDate, renderFormattedTime } from "@plane/utils";
// components
import type { TPageRootHandlers } from "@/components/pages/editor/page-root";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useQueryParams } from "@/hooks/use-query-params";
import { ProjectPageVersionService } from "@/services/page/project-page-version.service";
import { setToast } from "@plane/blocks/toast";
// store
import type { TPageInstance } from "@/store/pages/base-page";
// local imports
import { PAGE_NAVIGATION_PANE_VERSION_QUERY_PARAM } from "..";

type Props = {
  handleClose: () => void;
  page: TPageInstance;
  versionHistory: Pick<TPageRootHandlers, "fetchAllVersions">;
};

type TVersionGroup = {
  key: string;
  label: string;
  versions: TPageVersion[];
};

type VersionRowProps = {
  href: string;
  isActive: boolean;
  version?: TPageVersion;
  canEdit?: boolean;
  onToggleLock?: (version: TPageVersion) => void;
};

const SOURCE_KEYS = {
  mcp: "loom.version.source_mcp",
  "before-mcp": "loom.version.source_before_mcp",
  restore: "loom.version.source_restore",
  "before-restore": "loom.version.source_before_restore",
  manual: "loom.version.source_manual",
  "web-api": "loom.version.source_web_api",
  "before-web-api": "loom.version.source_before_web_api",
} as const;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const getStartOfDay = (value: Date | string) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const VersionRow = observer(function VersionRow(props: VersionRowProps) {
  const { href, isActive, version, canEdit, onToggleLock } = props;
  // store hooks
  const { getUserDetails } = useMember();
  // translation
  const { t } = useTranslation();
  // derived values
  const versionCreator = version ? getUserDetails(version.owned_by) : undefined;

  return (
    <li>
      <Link
        href={href}
        className={cn("flex flex-col gap-1 rounded-md p-1.5 transition-colors", {
          "bg-layer-transparent-selected": isActive,
          "hover:bg-layer-transparent-hover": !isActive,
        })}
      >
        <p className="flex items-center gap-1 text-body-sm-medium text-primary">
          <span className="truncate">
            {version
              ? `${renderFormattedDate(version.last_saved_at)}, ${renderFormattedTime(version.last_saved_at)}`
              : t("page_navigation_pane.tabs.info.version_history.current_version")}
          </span>
          {version?.is_locked && <span title={t("loom.version.locked_hint")}>🔒</span>}
        </p>
        {version && (version.label || (version.source && version.source in SOURCE_KEYS)) && (
          <p className="truncate text-caption-sm-regular text-secondary">
            {version.label || t(SOURCE_KEYS[version.source as keyof typeof SOURCE_KEYS])}
          </p>
        )}
        {version && (
          <span className="flex items-center gap-1">
            <Avatar
              alt={versionCreator?.display_name}
              fallback={versionCreator?.display_name?.[0]?.toUpperCase()}
              size="2xs"
              src={getFileURL(versionCreator?.avatar_url ?? "")}
            />
            <span className="truncate text-caption-sm-regular text-secondary">
              {versionCreator?.display_name ?? t("common.deactivated_user")}
            </span>
          </span>
        )}
      </Link>
      {version && canEdit && onToggleLock && (
        <button
          type="button"
          className="mt-0.5 ml-1.5 text-caption-sm-regular text-tertiary hover:text-primary"
          onClick={() => onToggleLock(version)}
        >
          {version.is_locked ? t("loom.version.unlock") : t("loom.version.lock")}
        </button>
      )}
    </li>
  );
});

export const PageNavigationPaneVersionHistoryPanel = observer(function PageNavigationPaneVersionHistoryPanel(
  props: Props
) {
  const { handleClose, page, versionHistory } = props;
  // navigation
  const searchParams = useSearchParams();
  const activeVersion = searchParams.get(PAGE_NAVIGATION_PANE_VERSION_QUERY_PARAM);
  // derived values
  const { id } = page;
  const { workspaceSlug, projectId } = useParams();
  const canEdit = page.canCurrentUserEditPage;
  const [saving, setSaving] = useState(false);
  const [naming, setNaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  // translation
  const { currentLocale, t } = useTranslation();
  // query params
  const { updateQueryParams } = useQueryParams();
  // fetch all versions
  const {
    data: versionsList,
    error: versionsListError,
    isValidating: isValidatingVersions,
    mutate: mutateVersionsList,
  } = useSWR(id ? `PAGE_VERSIONS_LIST_${id}` : null, id ? () => versionHistory.fetchAllVersions(id) : null);

  // [team 二开] 锁定、解锁版本，手动保存当前内容为一个版本
  const versionService = useMemo(() => new ProjectPageVersionService(), []);
  const handleToggleLock = useCallback(
    (version: TPageVersion) => {
      if (!id || !workspaceSlug || !projectId) return;
      void versionService
        .updateVersion(workspaceSlug.toString(), projectId.toString(), id, version.id, { is_locked: !version.is_locked })
        .then(() => mutateVersionsList())
        .catch(() => setToast({ type: "error", title: t("loom.version.op_failed") }));
    },
    [id, mutateVersionsList, projectId, versionService, workspaceSlug, t]
  );
  const handleSaveSnapshot = useCallback(
    (label: string) => {
    if (!id || !workspaceSlug || !projectId) return;
    setSaving(true);
    void versionService
      .saveSnapshot(workspaceSlug.toString(), projectId.toString(), id, { label: label.trim() })
      .then(() => {
        setToast({ type: "success", title: t("loom.version.saved") });
        return mutateVersionsList();
      })
      .catch(() => setToast({ type: "error", title: t("loom.version.save_failed") }))
      .finally(() => {
        setSaving(false);
        setNaming(false);
        setLabelDraft("");
      });
    },
    [id, mutateVersionsList, projectId, versionService, workspaceSlug, t]
  );

  const getVersionLink = useCallback(
    (versionID?: string) =>
      versionID
        ? updateQueryParams({ paramsToAdd: { [PAGE_NAVIGATION_PANE_VERSION_QUERY_PARAM]: versionID } })
        : updateQueryParams({ paramsToRemove: [PAGE_NAVIGATION_PANE_VERSION_QUERY_PARAM] }),
    [updateQueryParams]
  );

  // versions grouped by the day they were saved, newest first. Today's group always exists since it
  // holds the current version; today and yesterday read as relative days.
  const versionGroups = useMemo<TVersionGroup[]>(() => {
    // Intl knows Ukrainian as "uk"; the app stores it as "ua"
    const intlLocale = currentLocale === "ua" ? "uk" : currentLocale;
    const relativeDayFormatter = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
    const dayFormatter = new Intl.DateTimeFormat(intlLocale, { weekday: "short", day: "numeric", month: "short" });
    const today = getStartOfDay(new Date());

    const getGroupLabel = (day: Date) => {
      const dayOffset = Math.round((day.getTime() - today.getTime()) / DAY_IN_MS);
      return dayOffset === 0 || dayOffset === -1
        ? relativeDayFormatter.format(dayOffset, "day")
        : dayFormatter.format(day);
    };

    const groups = new Map<string, TVersionGroup>([
      [today.toDateString(), { key: today.toDateString(), label: getGroupLabel(today), versions: [] }],
    ]);
    for (const version of versionsList ?? []) {
      const day = getStartOfDay(version.last_saved_at);
      const key = day.toDateString();
      const group = groups.get(key) ?? { key, label: getGroupLabel(day), versions: [] };
      group.versions.push(version);
      groups.set(key, group);
    }
    return Array.from(groups.values());
  }, [currentLocale, versionsList]);

  return (
    <div className="flex h-full flex-col px-3.5">
      <div className="flex h-6 shrink-0 items-center justify-between gap-2">
        <h2 className="text-body-sm-medium text-primary">
          {t("page_navigation_pane.tabs.info.version_history.label")}
        </h2>
        <IconButton
          variant="ghost"
          size="xs"
          icon={<Icon icon={CloseOutline} />}
          onClick={handleClose}
          aria-label={t("page_navigation_pane.close_button")}
        />
      </div>
      {canEdit && (
        <div className="mt-3">
          {naming ? (
            <div className="flex flex-col gap-2">
              <input
                autoFocus
                value={labelDraft}
                maxLength={100}
                placeholder={t("loom.version.name_placeholder")}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveSnapshot(labelDraft.trim());
                  if (e.key === "Escape") setNaming(false);
                }}
                className="w-full rounded-md border border-subtle bg-layer-1 px-2 py-1 text-caption-md-regular text-primary outline-none focus:border-accent-strong"
              />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" stretch="auto" loading={saving} onClick={() => handleSaveSnapshot(labelDraft.trim())} label={t("loom.common.save")} />
                <Button variant="ghost" size="sm" stretch="auto" onClick={() => setNaming(false)} label={t("loom.common.cancel")} />
              </div>
            </div>
          ) : (
            <Button variant="secondary" size="sm" stretch="auto" onClick={() => setNaming(true)} label={t("loom.version.save_current")} />
          )}
        </div>
      )}
      <div className="vertical-scrollbar mt-4 scrollbar-sm flex-1 space-y-4 overflow-y-auto pb-4">
        {versionsListError ? (
          <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
            <p className="text-caption-md-regular text-secondary">
              {t("page_navigation_pane.tabs.version_history.list_error_description")}
            </p>
            <Button
              variant="ghost"
              size="sm"
              stretch="auto"
              loading={isValidatingVersions}
              onClick={() => void mutateVersionsList()}
              label={t("page_navigation_pane.tabs.version_history.try_again")}
            />
          </div>
        ) : (
          versionGroups.map((group, index) => (
            <div key={group.key}>
              <p className="mb-2 text-caption-md-medium text-tertiary first-letter:uppercase">{group.label}</p>
              <ul className="flex flex-col gap-1">
                {index === 0 && <VersionRow href={getVersionLink()} isActive={!activeVersion} />}
                {group.versions.map((version) => (
                  <VersionRow
                    key={version.id}
                    href={getVersionLink(version.id)}
                    isActive={activeVersion === version.id}
                    version={version}
                    canEdit={canEdit}
                    onToggleLock={handleToggleLock}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
