/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import ts from "highlight.js/lib/languages/typescript";
import { common, createLowlight } from "lowlight";
import { CopyOutline, TickOutline } from "@makeplane/propel/icons";
import { useEffect, useId, useState } from "react";
// ui
import { IconButton } from "@makeplane/propel/components/icon-button";
// types
import type { TCodeBlockAttributes } from "./types";
import { ECodeBlockAttributeNames } from "./types";

// we just have ts support for now
const lowlight = createLowlight(common);
lowlight.register("ts", ts);

type Props = {
  node: ProseMirrorNode;
  editor?: { isEditable: boolean };
};

// [team 二开] language 为 mermaid 的代码块，下方实时渲染流程图（mermaid 按需加载，不影响首屏）
function MermaidPreview({ code }: { code: string }) {
  const rid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!code.trim()) {
      setSvg("");
      setError("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { default: mermaid } = await import("mermaid");
          const dark = document.documentElement.getAttribute("data-theme")?.includes("dark");
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
          await mermaid.parse(code);
          const { svg: out } = await mermaid.render(`m${rid}${Date.now()}`, code);
          if (!cancelled) {
            setSvg(out);
            setError("");
          }
        } catch (e) {
          // 渲染失败时保留上一次的图，只提示错误
          if (!cancelled) setError(e instanceof Error ? e.message.split("\n")[0] : "流程图语法有误");
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, rid]);

  return (
    <div contentEditable={false} className="mb-2 rounded-lg border border-subtle bg-surface-1 p-3">
      {error && <div className="mb-2 text-caption-md-regular text-danger-primary">流程图语法有误：{error}</div>}
      {svg ? (
        <div className="flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        !error && <div className="text-caption-md-regular text-tertiary">正在渲染流程图…</div>
      )}
    </div>
  );
}

export function CodeBlockComponent({ node }: Props) {
  const [copied, setCopied] = useState(false);
  // [team 二开] 流程图块的显示方式：只看图（默认）/ 图和代码都显示 / 只看代码；新建的空块直接显示代码方便输入
  const [mode, setMode] = useState<"preview" | "both" | "code">(() => (node.textContent.trim() ? "preview" : "both"));
  // derived values
  const attrs = node.attrs as TCodeBlockAttributes;
  const isMermaid = attrs[ECodeBlockAttributeNames.LANGUAGE]?.toLowerCase() === "mermaid";

  const copyToClipboard = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      setCopied(false);
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <NodeViewWrapper key={attrs[ECodeBlockAttributeNames.ID]} className="code-block group/code relative">
      <div className="pointer-events-none absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-focus-within/code:pointer-events-auto group-focus-within/code:opacity-100 group-hover/code:pointer-events-auto group-hover/code:opacity-100">
        {isMermaid && (
          <div contentEditable={false} className="flex overflow-hidden rounded-md border border-subtle bg-surface-1 text-caption-md-regular">
            {(
              [
                ["code", "代码"],
                ["both", "代码+图"],
                ["preview", "图"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                title={key === "code" ? "只看代码" : key === "both" ? "代码和图都显示" : "只看图"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMode(key)}
                className={`px-2 py-1 ${mode === key ? "bg-layer-transparent-hover text-primary" : "text-tertiary hover:text-primary"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <IconButton
          aria-label={copied ? "Copied code" : "Copy code"}
          variant="secondary"
          size="lg"
          icon={copied ? <TickOutline className="text-success-primary" /> : <CopyOutline />}
          onClick={(e) => void copyToClipboard(e)}
        />
      </div>

      <pre className={`my-2 rounded-lg bg-layer-3 p-4 text-primary ${isMermaid && mode === "preview" ? "hidden" : ""}`}>
        <NodeViewContent<"code"> as="code" className="whitespace-pre-wrap" />
      </pre>
      {isMermaid && mode !== "code" && <MermaidPreview code={node.textContent} />}
    </NodeViewWrapper>
  );
}
