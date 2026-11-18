/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 团队模板管理：文档、工作项的常用写法骨架（Markdown）。Agent 用 MCP 的 list_templates / get_template 读取。
import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import { API_BASE_URL } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { setToast } from "@plane/blocks/toast";
import { PageHead } from "@/components/core/page-title";
import { useProject } from "@/hooks/store/use-project";
import { APIService } from "@/services/api.service";
import type { Route } from "./+types/page";

type Tpl = { id: string; kind: "page" | "issue"; name: string; description: string; project_id: string | null; body?: string };

class TemplateService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  list(slug: string): Promise<{ templates: Tpl[] }> {
    return this.get(`/api/workspaces/${slug}/team-templates/`).then((r) => r?.data);
  }
  one(slug: string, id: string): Promise<Tpl> {
    return this.get(`/api/workspaces/${slug}/team-templates/${id}/`).then((r) => r?.data);
  }
  create(slug: string, body: Partial<Tpl> & { project_id?: string | null }): Promise<Tpl> {
    return this.post(`/api/workspaces/${slug}/team-templates/`, body).then((r) => r?.data);
  }
  save(slug: string, id: string, body: Partial<Tpl>): Promise<Tpl> {
    return this.patch(`/api/workspaces/${slug}/team-templates/${id}/`, body).then((r) => r?.data);
  }
  remove(slug: string, id: string) {
    return this.delete(`/api/workspaces/${slug}/team-templates/${id}/`);
  }
}
const service = new TemplateService();

const EMPTY = { id: "", kind: "page" as const, name: "", description: "", body: "", project_id: "" };

function TemplatesPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const { t } = useTranslation();
  const { joinedProjectIds, getProjectById } = useProject();
  const [list, setList] = useState<Tpl[]>([]);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    service
      .list(workspaceSlug)
      .then((r) => setList(r.templates))
      .catch(() => setToast({ type: "error", title: t("loom.templates.load_failed") }));
  }, [workspaceSlug, t]);
  useEffect(load, [load]);

  const edit = (id: string) =>
    service
      .one(workspaceSlug, id)
      .then((x) => setForm({ id: x.id, kind: x.kind as "page", name: x.name, description: x.description, body: x.body ?? "", project_id: x.project_id ?? "" }))
      .catch(() => setToast({ type: "error", title: t("loom.templates.load_failed") }));

  const submit = () => {
    if (!form || !form.name.trim()) return;
    setSaving(true);
    const req = form.id
      ? service.save(workspaceSlug, form.id, { name: form.name, description: form.description, body: form.body })
      : service.create(workspaceSlug, { kind: form.kind, name: form.name, description: form.description, body: form.body, project_id: form.project_id || null });
    req
      .then(() => {
        setToast({ type: "success", title: t("loom.templates.saved") });
        setForm(null);
        load();
      })
      .catch((e) => setToast({ type: "error", title: e?.response?.data?.error ?? t("loom.templates.save_failed") }))
      .finally(() => setSaving(false));
  };

  const remove = (id: string) => {
    if (!window.confirm(t("loom.templates.confirm_delete"))) return;
    service
      .remove(workspaceSlug, id)
      .then(() => load())
      .catch((e) => setToast({ type: "error", title: e?.response?.data?.error ?? t("loom.templates.save_failed") }));
  };

  const input = "w-full rounded-md border border-subtle bg-layer-1 px-3 py-2 text-body-sm-regular text-primary outline-none focus:border-accent-strong";
  return (
    <>
      <PageHead title={t("loom.templates.title")} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-h5-semibold text-primary">{t("loom.templates.title")}</h1>
            <p className="text-body-sm-regular text-secondary">{t("loom.templates.desc")}</p>
          </div>
          {!form && (
            <button type="button" className="rounded-md bg-accent-primary px-4 py-2 text-body-sm-medium text-on-color" onClick={() => setForm({ ...EMPTY })}>
              {t("loom.templates.new")}
            </button>
          )}
        </div>
        {form && (
          <div className="flex flex-col gap-2 rounded-md border border-subtle p-4">
            <div className="flex gap-2">
              <select disabled={!!form.id} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "page" })} className={input + " max-w-40"}>
                <option value="page">{t("loom.templates.kind_page")}</option>
                <option value="issue">{t("loom.templates.kind_issue")}</option>
              </select>
              <select disabled={!!form.id} value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className={input}>
                <option value="">{t("loom.templates.scope_workspace")}</option>
                {(joinedProjectIds ?? []).map((id) => (
                  <option key={id} value={id}>
                    {getProjectById(id)?.name}
                  </option>
                ))}
              </select>
            </div>
            <input className={input} maxLength={120} placeholder={t("loom.templates.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={input} maxLength={300} placeholder={t("loom.templates.when")} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <textarea className={input + " min-h-60 font-mono"} placeholder={t("loom.templates.body_placeholder")} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            <div className="flex gap-2">
              <button type="button" disabled={saving} className="rounded-md bg-accent-primary px-4 py-2 text-body-sm-medium text-on-color" onClick={submit}>
                {t("loom.common.save")}
              </button>
              <button type="button" className="rounded-md px-4 py-2 text-body-sm-regular text-secondary" onClick={() => setForm(null)}>
                {t("loom.common.cancel")}
              </button>
            </div>
          </div>
        )}
        {!list.length && !form ? (
          <p className="py-8 text-center text-body-sm-regular text-secondary">{t("loom.templates.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-subtle rounded-md border border-subtle">
            {list.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-body-sm-medium text-primary">
                    {x.name} <span className="ml-2 text-caption-sm-regular text-tertiary">{x.kind === "page" ? t("loom.templates.kind_page") : t("loom.templates.kind_issue")} · {x.project_id ? (getProjectById(x.project_id)?.name ?? "") : t("loom.templates.scope_workspace")}</span>
                  </p>
                  {x.description && <p className="truncate text-caption-md-regular text-secondary">{x.description}</p>}
                </div>
                <div className="flex shrink-0 gap-3 text-caption-md-regular">
                  <button type="button" className="text-secondary hover:text-primary" onClick={() => void edit(x.id)}>
                    {t("loom.templates.edit")}
                  </button>
                  <button type="button" className="text-secondary hover:text-primary" onClick={() => remove(x.id)}>
                    {t("loom.templates.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export default observer(TemplatesPage);
