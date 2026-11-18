/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 跨项目、跨文档统一搜索页：标题和正文，带命中片段，可按类型和项目筛选。
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "@plane/i18n";
import { API_BASE_URL } from "@plane/constants";
import { PageHead } from "@/components/core/page-title";
import { useProject } from "@/hooks/store/use-project";
import { APIService } from "@/services/api.service";
import type { Route } from "./+types/page";

type Hit = {
  type: "page" | "issue";
  id: string;
  project_id: string;
  project: string;
  identifier: string;
  key?: string;
  title: string;
  state?: string | null;
  snippet: string;
  updated_at: string;
};
type Result = { pages?: Hit[]; issues?: Hit[] };

class SearchService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  async search(slug: string, q: string, types: string, project: string): Promise<Result> {
    const qs = new URLSearchParams({ q, types, limit: "30" });
    if (project) qs.set("project", project);
    return this.get(`/api/workspaces/${slug}/team-search/?${qs.toString()}`)
      .then((r) => r?.data)
      .catch((e) => {
        throw e?.response?.data;
      });
  }
}
const service = new SearchService();

// 命中的关键词高亮
function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.split(/\s+/).filter(Boolean);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-sm bg-yellow-400/30 text-inherit">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function SearchPage({ params }: Route.ComponentProps) {
  const { workspaceSlug } = params;
  const { t } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? "";
  const type = sp.get("type") ?? "all";
  const project = sp.get("project") ?? "";
  const [draft, setDraft] = useState(q);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const { joinedProjectIds, getProjectById } = useProject();

  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    if (!q.trim()) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    service
      .search(workspaceSlug, q, type === "all" ? "page,issue" : type, project)
      .then((r) => !cancelled && setResult(r))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, q, type, project]);

  const update = (next: Record<string, string>) => {
    const n = new URLSearchParams(sp);
    Object.entries(next).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    setSp(n);
  };

  const pages = result?.pages ?? [];
  const issues = result?.issues ?? [];
  const row = (h: Hit) => (
    <li key={`${h.type}-${h.id}`}>
      <Link
        to={h.type === "page" ? `/${workspaceSlug}/projects/${h.project_id}/pages/${h.id}` : `/${workspaceSlug}/browse/${h.key}`}
        className="flex flex-col gap-1 rounded-md px-3 py-2 hover:bg-layer-transparent-hover"
      >
        <span className="flex items-center gap-2 text-body-sm-medium text-primary">
          {h.type === "issue" && <span className="text-secondary">{h.key}</span>}
          <Highlight text={h.title || t("loom.search.untitled")} query={q} />
          {h.state && <span className="rounded bg-layer-2 px-1.5 py-0.5 text-caption-sm-regular text-secondary">{h.state}</span>}
        </span>
        {h.snippet && (
          <span className="line-clamp-2 text-caption-md-regular text-secondary">
            <Highlight text={h.snippet} query={q} />
          </span>
        )}
        <span className="text-caption-sm-regular text-tertiary">{h.project}</span>
      </Link>
    </li>
  );

  return (
    <>
      <PageHead title={t("loom.search.title")} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: draft.trim() });
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("loom.search.placeholder")}
            className="flex-1 rounded-md border border-subtle bg-layer-1 px-3 py-2 text-body-sm-regular text-primary outline-none focus:border-accent-strong"
          />
          <button type="submit" className="rounded-md bg-accent-primary px-4 py-2 text-body-sm-medium text-on-color">
            {t("loom.search.button")}
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2 text-caption-md-regular">
          {(["all", "page", "issue"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => update({ type: k === "all" ? "" : k })}
              className={`rounded-full border px-3 py-1 ${type === k ? "border-accent-strong text-primary" : "border-subtle text-secondary"}`}
            >
              {t(`loom.search.type_${k}`)}
            </button>
          ))}
          <select
            value={project}
            onChange={(e) => update({ project: e.target.value })}
            className="rounded-md border border-subtle bg-layer-1 px-2 py-1 text-secondary"
          >
            <option value="">{t("loom.search.all_projects")}</option>
            {(joinedProjectIds ?? []).map((id) => (
              <option key={id} value={id}>
                {getProjectById(id)?.name}
              </option>
            ))}
          </select>
        </div>
        {!q.trim() ? (
          <p className="py-8 text-center text-body-sm-regular text-secondary">{t("loom.search.hint")}</p>
        ) : loading ? (
          <p className="py-8 text-center text-body-sm-regular text-secondary">{t("loom.access.loading")}</p>
        ) : error ? (
          <p className="py-8 text-center text-body-sm-regular text-secondary">{t("loom.search.failed")}</p>
        ) : !pages.length && !issues.length ? (
          <p className="py-8 text-center text-body-sm-regular text-secondary">{t("loom.search.empty", { q })}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {pages.length > 0 && (
              <section>
                <h2 className="mb-1 px-3 text-caption-md-medium text-tertiary">
                  {t("loom.search.type_page")} · {pages.length}
                </h2>
                <ul>{pages.map(row)}</ul>
              </section>
            )}
            {issues.length > 0 && (
              <section>
                <h2 className="mb-1 px-3 text-caption-md-medium text-tertiary">
                  {t("loom.search.type_issue")} · {issues.length}
                </h2>
                <ul>{issues.map(row)}</ul>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default observer(SearchPage);
