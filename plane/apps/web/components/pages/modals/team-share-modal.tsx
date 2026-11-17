/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 文档公开只读链接：作者、项目管理员、项目负责人或工作区管理员打开后生成一个不用登录就能看的链接，关闭后旧链接立即失效。
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Button } from "@makeplane/propel/components/button";
import { Switch } from "@makeplane/propel/components/switch";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { CopyOutline } from "@makeplane/propel/icons";
import { setToast } from "@plane/blocks/toast";
import { API_BASE_URL, SITES_URL } from "@plane/constants";
import { copyTextToClipboard } from "@plane/utils";
import { APIService } from "@/services/api.service";

type Share = { anchor: string | null; can_manage: boolean };

class TeamPageShareService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  path(ws: string, project: string, page: string) {
    return `/api/workspaces/${ws}/projects/${project}/pages/${page}/team-share/`;
  }
  async fetch(ws: string, project: string, page: string): Promise<Share> {
    return this.get(this.path(ws, project, page)).then((r) => r.data as Share);
  }
  async enable(ws: string, project: string, page: string): Promise<Share> {
    return this.post(this.path(ws, project, page), {}).then((r) => r.data as Share);
  }
  async disable(ws: string, project: string, page: string): Promise<Share> {
    return this.delete(this.path(ws, project, page)).then((r) => r.data as Share);
  }
}
const service = new TeamPageShareService();

export function publicPageUrl(anchor: string) {
  const base = SITES_URL.startsWith("http") ? SITES_URL : `${window.location.origin}${SITES_URL}`;
  return `${base.replace(/\/$/, "")}/team-pages/${anchor}`;
}

type Props = { isOpen: boolean; onClose: () => void; pageId: string; isPrivate: boolean };

export function TeamPageShareModal({ isOpen, onClose, pageId, isPrivate }: Props) {
  const { workspaceSlug = "", projectId = "" } = useParams();
  const [share, setShare] = useState<Share | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen || !projectId) return;
    service
      .fetch(workspaceSlug, projectId, pageId)
      .then(setShare)
      .catch(() => setShare({ anchor: null, can_manage: false }));
  }, [isOpen, workspaceSlug, projectId, pageId]);

  const toggle = async () => {
    if (!share) return;
    setBusy(true);
    try {
      const next = share.anchor
        ? await service.disable(workspaceSlug, projectId, pageId)
        : await service.enable(workspaceSlug, projectId, pageId);
      setShare(next);
      setToast({
        type: "success",
        title: next.anchor ? "已公开" : "已关闭公开链接",
        message: next.anchor ? "拿到链接的人不用登录就能阅读这篇文档" : "旧链接已失效",
      });
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setToast({ type: "error", title: "操作失败", message: msg ?? "请稍后再试" });
    } finally {
      setBusy(false);
    }
  };

  const url = share?.anchor ? publicPageUrl(share.anchor) : "";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>公开链接</DialogTitle>
              <DialogDescription>
                打开后任何拿到链接的人都能阅读这篇文档（只读，看不到评论和项目里的其他内容）。关闭后旧链接立即失效。
              </DialogDescription>
            </DialogHeading>
          </DialogHeader>
          <DialogBody>
            {!share ? (
              <div className="text-body-sm-regular text-tertiary">加载中…</div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-body-sm-medium text-primary">{share.anchor ? "已公开" : "未公开"}</span>
                  {share.can_manage ? (
                    <Switch size="md" checked={Boolean(share.anchor)} disabled={busy || (isPrivate && !share.anchor)} onCheckedChange={() => void toggle()} />
                  ) : (
                    <span className="text-caption-sm-regular text-tertiary">只有文档作者、项目管理员、项目负责人和工作区管理员能开关</span>
                  )}
                </div>
                {isPrivate && !share.anchor && (
                  <div className="text-caption-sm-regular text-tertiary">私有文档不能公开，先把它改成项目内公开。</div>
                )}
                {url && (
                  <button
                    type="button"
                    onClick={() =>
                      void copyTextToClipboard(url).then(() =>
                        setToast({ type: "success", title: "已复制", message: "公开链接已复制" })
                      )
                    }
                    className="flex w-full items-center justify-between gap-2 rounded-md border-[0.5px] border-subtle px-3 py-2 text-left text-caption-sm-regular break-all outline-none"
                  >
                    <span>{url}</span>
                    <CopyOutline className="h-4 w-4 flex-shrink-0 text-placeholder" />
                  </button>
                )}
              </div>
            )}
          </DialogBody>
        </DialogMain>
        <DialogActions>
          <Button variant="secondary" size="sm" stretch="auto" label="关闭" onClick={onClose} />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
