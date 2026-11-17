/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 更新日志：内容来自仓库根目录 CHANGELOG.md（发版时由 deploy/set-version.sh 复制到 public/changelog.md）。
// 升级后第一次打开页面自动弹一次，之后从帮助菜单底部的版本号进入。
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import packageJson from "package.json";

const SEEN_KEY = "loom-changelog-seen-version";

type Entry = { version: string; date: string; body: string };

/** 按「## 版本 · 日期」切成一版一段 */
function parseChangelog(text: string): Entry[] {
  return text
    .split(/^## /m)
    .slice(1)
    .map((chunk) => {
      const nl = chunk.indexOf("\n");
      const [version, date = ""] = chunk.slice(0, nl).split("·").map((x) => x.trim());
      return { version, date, body: chunk.slice(nl + 1).trim() };
    });
}

const mdComponents = {
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="mt-4 mb-1.5 text-14 font-semibold text-primary">{children}</h3>,
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-1.5 leading-6">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded-sm bg-layer-2 px-1 text-caption-sm-regular">{children}</code>
  ),
};

export function ChangelogModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!isOpen || text !== null) return;
    fetch(`/changelog.md?v=${packageJson.version}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setText)
      .catch(() => setText(""));
  }, [isOpen, text]);

  const entries = text ? parseChangelog(text) : [];
  const current = entries[active];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>更新日志（当前 v{packageJson.version}）</DialogTitle>
            </DialogHeading>
          </DialogHeader>
          <DialogBody>
            {text === null ? (
              <div className="text-body-sm-regular text-tertiary">加载中…</div>
            ) : !current ? (
              <div className="text-body-sm-regular text-tertiary">暂时读不到更新日志。</div>
            ) : (
              <div className="flex h-[60vh] gap-4">
                <nav className="flex w-36 shrink-0 flex-col gap-1 overflow-y-auto border-r border-subtle pr-2">
                  {entries.map((e, i) => (
                    <button
                      key={e.version}
                      type="button"
                      onClick={() => setActive(i)}
                      className={`flex flex-col rounded-md px-2 py-1.5 text-left ${i === active ? "bg-layer-transparent-active text-primary" : "text-secondary hover:bg-layer-transparent-hover"}`}
                    >
                      <span className="text-body-sm-medium">v{e.version}</span>
                      <span className="text-caption-sm-regular text-tertiary">{e.date}</span>
                    </button>
                  ))}
                </nav>
                <div className="min-w-0 flex-1 overflow-y-auto pr-2 text-body-sm-regular text-secondary">
                  <ReactMarkdown components={mdComponents}>{current.body}</ReactMarkdown>
                </div>
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

/** 帮助菜单里的版本号按钮；升级后第一次打开自动弹出更新日志。 */
export function useChangelog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const seen = localStorage.getItem(SEEN_KEY);
      // 没记录过或版本变了都弹一次（这一版之前没有记录，所以升级到这一版的人也会看到）
      if (seen !== packageJson.version) setOpen(true);
      localStorage.setItem(SEEN_KEY, packageJson.version);
    } catch {
      /* 浏览器禁用了本地存储就不提示 */
    }
  }, []);
  return { open, setOpen };
}
