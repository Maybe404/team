/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 编辑权限：没有编辑权限的成员可以申请；拥有者（文档作者、工作项创建人和指派人）和管理员可以批准申请，
// 也可以直接指定共同维护人。文档和工作项通用。
import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
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

/** 页面内的一行输入 + 确认/取消，代替浏览器自带的 prompt 弹窗 */
function InlineAsk(props: { placeholder: string; confirmLabel: string; busy?: boolean; onConfirm: (value: string) => void; onCancel: () => void }) {
  const { placeholder, confirmLabel, busy, onConfirm, onCancel } = props;
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={value}
        maxLength={200}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm(value.trim());
          if (e.key === "Escape") onCancel();
        }}
        className="min-w-48 flex-1 rounded-md border border-subtle bg-layer-1 px-2 py-1 text-caption-md-regular text-primary outline-none focus:border-accent-strong"
      />
      <Button variant="primary" size="sm" stretch="auto" loading={busy} label={confirmLabel} onClick={() => onConfirm(value.trim())} />
      <Button variant="ghost" size="sm" stretch="auto" label={t("loom.common.cancel")} onClick={onCancel} />
    </div>
  );
}

const errMsg = (e: unknown): string | undefined => (e as { response?: { data?: { error?: string } } })?.response?.data?.error;

export function useAccessStatus(workspaceSlug: string, type: TAccessType, id: string | undefined) {
  const [status, setStatus] = useState<TAccessStatus | null>(null);
  const latestKey = useRef("");
  const key = `${workspaceSlug}|${type}|${id ?? ""}`;
  latestKey.current = key;
  const reload = useCallback(() => {
    if (!workspaceSlug || !id) return;
    service
      .fetch(workspaceSlug, type, id)
      // 切换到别的工作项后，晚到的旧请求不能覆盖当前状态
      .then((s) => {
        if (latestKey.current === `${workspaceSlug}|${type}|${id}`) setStatus(s);
      })
      .catch(() => {
        if (latestKey.current === `${workspaceSlug}|${type}|${id}`) setStatus(null);
      });
  }, [workspaceSlug, type, id]);
  // 对象变了先清空，避免短暂沿用上一个对象的编辑状态
  useEffect(() => {
    setStatus(null);
    reload();
  }, [reload]);
  // 状态属于哪个对象：不属于当前对象时当作还没加载
  return { status: status && status.entity_id === id ? status : null, setStatus, reload };
}

/** 没有编辑权限时显示在页面顶部的提示条：说明现状，可以申请。 */
export function AccessRequestBar(props: { workspaceSlug: string; type: TAccessType; id: string | undefined }) {
  const { workspaceSlug, type, id } = props;
  const { status, setStatus } = useAccessStatus(workspaceSlug, type, id);
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  if (!status || status.can_edit) return null;
  const pending = status.my_request?.status === "pending";
  const ask = async (message: string) => {
    if (!id) return;
    setBusy(true);
    try {
      setStatus(await service.act(workspaceSlug, type, id, { action: "request", message }));
      setToast({ type: "success", title: t("loom.access.request_sent"), message: t("loom.access.request_sent_hint") });
      setAsking(false);
    } catch (e) {
      setToast({ type: "error", title: t("loom.access.request_failed"), message: errMsg(e) ?? t("loom.common.retry_later") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-subtle bg-layer-2 px-5 py-2 text-caption-md-regular text-secondary">
      <span className="flex-1">
        {t("loom.access.read_only_bar", { owners: status.owners.map((o) => o.name).join(", ") || "—" })}
        {status.my_request?.status === "rejected" ? ` ${t("loom.access.last_rejected")}` : ""}
      </span>
      {pending ? (
        <span className="text-tertiary">{t("loom.access.you_requested")}</span>
      ) : asking ? (
        <InlineAsk placeholder={t("loom.access.request_placeholder")} confirmLabel={t("loom.access.request_confirm")} busy={busy} onConfirm={(m) => void ask(m)} onCancel={() => setAsking(false)} />
      ) : (
        <Button variant="secondary" size="sm" stretch="auto" label={t("loom.access.request_button")} onClick={() => setAsking(true)} />
      )}
    </div>
  );
}

type ModalProps = { isOpen: boolean; onClose: () => void; workspaceSlug: string; type: TAccessType; id: string };

/** 编辑权限弹窗：拥有者和管理员看到共同维护人和待批准的申请；其他人看到现状并可以申请。 */
export const TeamAccessModal = observer(function TeamAccessModal({ isOpen, onClose, workspaceSlug, type, id }: ModalProps) {
  const { t } = useTranslation();
  const { status, setStatus, reload } = useAccessStatus(workspaceSlug, type, isOpen ? id : undefined);
  const [asking, setAsking] = useState(false);
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
      setToast({ type: "error", title: t("loom.access.action_failed"), message: errMsg(e) ?? t("loom.common.retry_later") });
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
              <DialogTitle>{t("loom.access.title")}</DialogTitle>
              <DialogDescription>
                {type === "page" ? t("loom.access.desc_page") : t("loom.access.desc_issue")}
              </DialogDescription>
            </DialogHeading>
          </DialogHeader>
          <DialogBody>
            {!status ? (
              <div className="text-body-sm-regular text-tertiary">{t("loom.access.loading")}</div>
            ) : (
              <div className="flex flex-col gap-4 text-body-sm-regular text-primary">
                <div>
                  <div className="mb-1 text-caption-md-medium text-tertiary">{t("loom.access.owners")}</div>
                  <div>{status.owners.map((o) => o.name).join(", ") || "—"}</div>
                </div>
                <div>
                  <div className="mb-1 text-caption-md-medium text-tertiary">{t("loom.access.co_maintainers")}</div>
                  {status.editors.length === 0 && <div className="text-tertiary">{t("loom.access.none_yet")}</div>}
                  {status.editors.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-0.5">
                      <span>{p.name}</span>
                      {status.can_manage && (
                        <button
                          type="button"
                          disabled={busy}
                          className="text-caption-sm-regular text-danger-primary hover:underline"
                          onClick={() => void run({ action: "remove_editor", user_id: p.id }, t("loom.access.removed"))}
                        >
                          {t("loom.access.remove")}
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
                        <option value="">{t("loom.access.select_member")}</option>
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
                        label={t("loom.access.add")}
                        onClick={() => {
                          void run({ action: "add_editor", user_id: pick }, t("loom.access.added"));
                          setPick("");
                        }}
                      />
                    </div>
                  )}
                </div>
                {status.can_manage && (
                  <div>
                    <div className="mb-1 text-caption-md-medium text-tertiary">{t("loom.access.pending_requests")}</div>
                    {(status.requests ?? []).length === 0 && <div className="text-tertiary">{t("loom.access.none")}</div>}
                    {(status.requests ?? []).map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 py-1">
                        <div className="min-w-0">
                          <div>{r.requester.name}</div>
                          {r.message && <div className="truncate text-caption-sm-regular text-tertiary">{r.message}</div>}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button variant="primary" size="sm" stretch="auto" disabled={busy} label={t("loom.access.approve")} onClick={() => void run({ action: "decide", request_id: r.id, approve: true }, t("loom.access.approved"))} />
                          <Button variant="secondary" size="sm" stretch="auto" disabled={busy} label={t("loom.access.reject")} onClick={() => void run({ action: "decide", request_id: r.id, approve: false }, t("loom.access.rejected"))} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!status.can_edit && (
                  <div>
                    {status.my_request?.status === "pending" ? (
                      <span className="text-tertiary">{t("loom.access.you_requested")}</span>
                    ) : asking ? (
                      <InlineAsk
                        placeholder={t("loom.access.request_placeholder")}
                        confirmLabel={t("loom.access.request_confirm")}
                        busy={busy}
                        onConfirm={(message) => {
                          void run({ action: "request", message }, t("loom.access.request_sent"));
                          setAsking(false);
                        }}
                        onCancel={() => setAsking(false)}
                      />
                    ) : (
                      <Button variant="primary" size="sm" stretch="auto" disabled={busy} label={t("loom.access.request_button")} onClick={() => setAsking(true)} />
                    )}
                  </div>
                )}
              </div>
            )}
          </DialogBody>
        </DialogMain>
        <DialogActions>
          <Button variant="secondary" size="sm" stretch="auto" label={t("loom.common.close")} onClick={onClose} />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
});

/** 侧栏里的一小块：一句话说明谁能编辑，点开弹窗申请或管理。 */
export function AccessSection(props: { workspaceSlug: string; type: TAccessType; id: string }) {
  const { workspaceSlug, type, id } = props;
  const { t } = useTranslation();
  const { status, reload } = useAccessStatus(workspaceSlug, type, id);
  const [open, setOpen] = useState(false);
  if (!status) return null;
  const pendingCount = status.requests?.length ?? 0;
  return (
    <div className="flex flex-col gap-1 text-caption-md-regular text-secondary">
      <div>
        {status.can_edit ? t("loom.access.can_edit") : t("loom.access.can_only_read")}
        {status.editors.length > 0 ? `; ${t("loom.access.co_maintainers_line", { names: status.editors.map((e) => e.name).join(", ") })}` : ""}
      </div>
      {pendingCount > 0 && <div className="text-accent-primary">{t("loom.access.pending_count", { count: pendingCount })}</div>}
      <button
        type="button"
        className="self-start text-accent-primary hover:underline"
        onClick={() => setOpen(true)}
      >
        {status.can_manage ? t("loom.access.manage") : status.can_edit ? t("loom.access.view") : t("loom.access.request_button")}
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
