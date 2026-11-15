/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 公开文档的只读页面：不需要登录，只显示这一篇文档。HTML 由服务端清洗过（白名单标签）。
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { API_BASE_URL } from "@plane/constants";
import { LogoSpinner } from "@/components/common/logo-spinner";
import { PageNotFound } from "@/components/ui/not-found";

type PublicPage = { name: string; html: string; updated_at: string; project_name: string; workspace_name: string };

export const headers = () => ({ "X-Robots-Tag": "noindex" });

const ARTICLE_CSS = `
.team-doc { line-height: 1.75; font-size: 16px; color: var(--text-color-primary, #1f2328); }
.team-doc h1 { font-size: 1.9em; font-weight: 600; margin: 1.2em 0 .5em; }
.team-doc h2 { font-size: 1.5em; font-weight: 600; margin: 1.2em 0 .5em; }
.team-doc h3 { font-size: 1.25em; font-weight: 600; margin: 1em 0 .4em; }
.team-doc h4, .team-doc h5, .team-doc h6 { font-weight: 600; margin: 1em 0 .4em; }
.team-doc p { margin: .6em 0; }
.team-doc ul { list-style: disc; padding-left: 1.5em; margin: .6em 0; }
.team-doc ol { list-style: decimal; padding-left: 1.5em; margin: .6em 0; }
.team-doc ul[data-type="taskList"] { list-style: none; padding-left: .2em; }
.team-doc li[data-type="taskItem"] { display: flex; gap: .5em; align-items: flex-start; }
.team-doc li[data-type="taskItem"] > div > p { margin: 0; }
.team-doc li[data-type="taskItem"] label, .team-doc li[data-type="taskItem"] input { position: static; margin: .45em 0 0; }
.team-doc li[data-type="taskItem"] input { appearance: auto; width: 14px; height: 14px; pointer-events: none; }
.team-doc a { color: #3f76ff; text-decoration: underline; }
.team-doc blockquote { border-left: 3px solid #d0d7de; padding-left: 1em; color: #57606a; margin: .8em 0; }
.team-doc code { background: rgba(127,127,127,.15); border-radius: 4px; padding: .1em .35em; font-size: .9em; }
.team-doc pre { background: rgba(127,127,127,.12); border-radius: 6px; padding: .9em 1em; overflow-x: auto; margin: .8em 0; }
.team-doc pre code { background: none; padding: 0; }
.team-doc table { border-collapse: collapse; margin: .8em 0; display: block; overflow-x: auto; }
.team-doc th, .team-doc td { border: 1px solid #d0d7de; padding: .4em .7em; text-align: left; }
.team-doc th { background: rgba(127,127,127,.08); font-weight: 600; }
.team-doc img { max-width: 100%; height: auto; border-radius: 6px; margin: .6em 0; }
.team-doc hr { border: 0; border-top: 1px solid #d0d7de; margin: 1.5em 0; }
`;

export default function TeamPublicPage() {
  const { anchor = "" } = useParams();
  const [page, setPage] = useState<PublicPage | null | undefined>(undefined);

  useEffect(() => {
    if (!/^[a-zA-Z0-9_-]+$/.test(anchor)) {
      setPage(null);
      return;
    }
    fetch(`${API_BASE_URL}/api/public/team-pages/${anchor}/`)
      .then((r) => (r.ok ? (r.json() as Promise<PublicPage>) : null))
      .then((p) => {
        setPage(p);
        if (p) document.title = p.name || "文档";
        return p;
      })
      .catch(() => setPage(null));
  }, [anchor]);

  if (page === undefined)
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <LogoSpinner />
      </div>
    );
  if (page === null) return <PageNotFound />;

  const html = page.html.replaceAll('src="/api/', `src="${API_BASE_URL}/api/`);
  return (
    <div className="min-h-screen w-full overflow-y-auto bg-surface-1">
      <style>{ARTICLE_CSS}</style>
      <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-2 text-caption-md-regular text-tertiary">
          {page.workspace_name} · {page.project_name} · 更新于 {new Date(page.updated_at).toLocaleDateString()}
        </div>
        <h1 className="mb-6 text-h3-semibold text-primary">{page.name || "无标题"}</h1>
        {/* 服务端已按白名单清洗 */}
        {/* eslint-disable-next-line react/no-danger */}
        <div className="team-doc" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>
  );
}
