/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 编辑权限：没有编辑权限的成员可以申请；拥有者（文档作者、工作项创建人和指派人）和管理员可以批准申请，
// 也可以直接指定共同维护人。文档和工作项通用。
import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
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
import { setToast } from "@plane/blocks/toast";
import { API_BASE_URL } from "@plane/constants";
import { useMember } from "@/hooks/store/use-member";
import { APIService } from "@/services/api.service";

export type TAccessType = "page" | "issue";
type Person = { id: string; name: string };
export type TAccessStatus = {
  entity_type: TAccessType;
  entity_id: string;
  title: string;
  can_edit: boolean;
  can_manage: boolean;
  owners: Person[];
  editors: Person[];
  my_request: { id: string; status: string; message: string } | null;
  requests?: { id: string; requester: Person; message: string; created_at: string }[];
};

class TeamAccessService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  path(ws: string, type: TAccessType, id: string) {
    return `/api/workspaces/${ws}/team-access/${type}/${id}/`;
  }
  fetch(ws: string, type: TAccessType, id: string) {
    return this.get(this.path(ws, type, id)).then((r) => r.data as TAccessStatus);
  }
  act(ws: string, type: TAccessType, id: string, body: Record<string, unknown>) {
    return this.post(this.path(ws, type, id), body).then((r) => r.data as TAccessStatus);
  }
}
const service = new TeamAccessService();

const errMsg = (e: unknown) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "请稍后再试";

export function useAccessStatus(workspaceSlug: string, type: TAccessType, id: string | undefined) {
  const [status, setStatus] = useState<TAccessStatus | null>(null);
  const reload = useCallback(() => {
    if (!workspaceSlug || !id) return;
    service
      .fetch(workspaceSlug, type, id)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [workspaceSlug, type, id]);
  useEffect(reload, [reload]);
  return { status, setStatus, reload };
}

/** 没有编辑权限时显示在页面顶部的提示条：说明现状，可以申请。 */
export function AccessRequestBar(props: { workspaceSlug: string; type: TAccessType; id: string | undefined }) {
  const { workspaceSlug, type, id } = props;
  const { status, setStatus } = useAccessStatus(workspaceSlug, type, id);
  const [busy, setBusy] = useState(false);
  if (!status || status.can_edit) return null;
  const pending = status.my_request?.status === "pending";
  const ask = async () => {
    const message = window.prompt("给拥有者留句话（可以留空）：", "");
    if (message === null || !id) return;
    setBusy(true);
    try {
      setStatus(await service.act(workspaceSlug, type, id, { action: "request", message }));
      setToast({ type: "success", title: "已发出申请", message: "拥有者批准后你就能编辑了" });
    } catch (e) {
      setToast({ type: "error", title: "申请失败", message: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-subtle bg-layer-2 px-5 py-2 text-caption-md-regular text-secondary">
      <span className="flex-1">
        你现在只能阅读和评论。拥有者：{status.owners.map((o) => o.name).join("、") || "—"}
        {status.my_request?.status === "rejected" ? "（上次申请被拒绝了，可以再申请）" : ""}
      </span>
      {pending ? (
        <span className="text-tertiary">已申请，等待批准</span>
      ) : (
        <Button variant="secondary" size="sm" stretch="auto" loading={busy} label="申请编辑权限" onClick={() => void ask()} />
      )}
    </div>
  );
}

type ModalProps = { isOpen: boolean; onClose: () => void; workspaceSlug: string; type: TAccessType; id: string };

/** 编辑权限弹窗：拥有者和管理员看到共同维护人和待批准的申请；其他人看到现状并可以申请。 */
export const TeamAccessModal = observer(function TeamAccessModal({ isOpen, onClose, workspaceSlug, type, id }: ModalProps) {
  const { status, setStatus, reload } = useAccessStatus(workspaceSlug, type, isOpen ? id : undefined);
  const {
    workspace: { workspaceMemberIds },
    getUserDetails,
  } = useMember();
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  useEffect(() => {
    if (isOpen) reload();
  }, [isOpen, reload]);

  const run = async (body: Record<string, unknown>, okTitle: string) => {
    setBusy(true);
    try {
      setStatus(await service.act(workspaceSlug, type, id, body));
      setToast({ type: "success", title: okTitle });
    } catch (e) {
      setToast({ type: "error", title: "操作失败", message: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const taken = new Set([...(status?.owners ?? []), ...(status?.editors ?? [])].map((p) => p.id));
  const candidates = (workspaceMemberIds ?? []).filter((m) => !taken.has(m));

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>编辑权限</DialogTitle>
              <DialogDescription>
                {type === "page" ? "文档作者" : "工作项创建人和指派人"}和管理员可以编辑。别人想改，可以申请；也可以直接指定共同维护人。
              </DialogDescription>
            </DialogHeading>
          </DialogHeader>
          <DialogBody>
            {!status ? (
              <div className="text-body-sm-regular text-tertiary">加载中…</div>
            ) : (
              <div className="flex flex-col gap-4 text-body-sm-regular text-primary">
                <div>
                  <div className="mb-1 text-caption-md-medium text-tertiary">拥有者</div>
                  <div>{status.owners.map((o) => o.name).join("、") || "—"}</div>
                </div>
                <div>
                  <div className="mb-1 text-caption-md-medium text-tertiary">共同维护人</div>
                  {status.editors.length === 0 && <div className="text-tertiary">还没有</div>}
                  {status.editors.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-0.5">
                      <span>{p.name}</span>
                      {status.can_manage && (
                        <button
                          type="button"
                          disabled={busy}
                          className="text-caption-sm-regular text-danger-primary hover:underline"
                          onClick={() => void run({ action: "remove_editor", user_id: p.id }, "已移除")}
                        >
                          移除
                        </button>
                      )}
                    </div>
                  ))}
                  {status.can_manage && (
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        value={pick}
                        onChange={(e) => setPick(e.target.value)}
                        className="min-w-0 flex-1 rounded border border-subtle bg-layer-1 px-2 py-1 text-caption-md-regular"
                      >
                        <option value="">选择成员…</option>
                        {candidates.map((m) => (
                          <option key={m} value={m}>
                            {getUserDetails(m)?.display_name ?? m}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="secondary"
                        size="sm"
                        stretch="auto"
                        disabled={!pick || busy}
                        label="添加"
                        onClick={() => {
                          void run({ action: "add_editor", user_id: pick }, "已添加共同维护人");
                          setPick("");
                        }}
                      />
                    </div>
                  )}
                </div>
                {status.can_manage && (
                  <div>
                    <div className="mb-1 text-caption-md-medium text-tertiary">待批准的申请</div>
                    {(status.requests ?? []).length === 0 && <div className="text-tertiary">没有</div>}
                    {(status.requests ?? []).map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 py-1">
                        <div className="min-w-0">
                          <div>{r.requester.name}</div>
                          {r.message && <div className="truncate text-caption-sm-regular text-tertiary">{r.message}</div>}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button variant="primary" size="sm" stretch="auto" disabled={busy} label="同意" onClick={() => void run({ action: "decide", request_id: r.id, approve: true }, "已同意")} />
                          <Button variant="secondary" size="sm" stretch="auto" disabled={busy} label="拒绝" onClick={() => void run({ action: "decide", request_id: r.id, approve: false }, "已拒绝")} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!status.can_edit && (
                  <div>
                    {status.my_request?.status === "pending" ? (
                      <span className="text-tertiary">你已申请，等待批准</span>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        stretch="auto"
                        disabled={busy}
                        label="申请编辑权限"
                        onClick={() => {
                          const message = window.prompt("给拥有者留句话（可以留空）：", "");
                          if (message !== null) void run({ action: "request", message }, "已发出申请");
                        }}
                      />
                    )}
                  </div>
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
});

/** 侧栏里的一小块：一句话说明谁能编辑，点开弹窗申请或管理。 */
export function AccessSection(props: { workspaceSlug: string; type: TAccessType; id: string }) {
  const { workspaceSlug, type, id } = props;
  const { status, reload } = useAccessStatus(workspaceSlug, type, id);
  const [open, setOpen] = useState(false);
  if (!status) return null;
  const pendingCount = status.requests?.length ?? 0;
  return (
    <div className="flex flex-col gap-1 text-caption-md-regular text-secondary">
      <div>
        {status.can_edit ? "你可以编辑" : "你只能阅读和评论"}
        {status.editors.length > 0 ? `；共同维护：${status.editors.map((e) => e.name).join("、")}` : ""}
      </div>
      {pendingCount > 0 && <div className="text-accent-primary">有 {pendingCount} 个编辑申请等你处理</div>}
      <button
        type="button"
        className="self-start text-accent-primary hover:underline"
        onClick={() => setOpen(true)}
      >
        {status.can_manage ? "管理编辑权限" : status.can_edit ? "查看编辑权限" : "申请编辑权限"}
      </button>
      <TeamAccessModal
        isOpen={open}
        onClose={() => {
          setOpen(false);
          reload();
        }}
        workspaceSlug={workspaceSlug}
        type={type}
        id={id}
      />
    </div>
  );
}
