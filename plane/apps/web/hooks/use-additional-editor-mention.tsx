/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
// plane editor
import type { TMentionSection } from "@plane/editor";
// plane types
import type { TSearchEntities, TSearchResponse } from "@plane/types";

const clean = (n?: string) => (n && n.trim()) || "无标题";

export type TUseAdditionalEditorMentionArgs = {
  enableAdvancedMentions: boolean;
};

export type TAdditionalEditorMentionHandlerArgs = {
  response: TSearchResponse;
};

export type TAdditionalEditorMentionHandlerReturnType = {
  sections: TMentionSection[];
};

export type TAdditionalParseEditorContentArgs = {
  id: string;
  entityType: TSearchEntities;
};

export type TAdditionalParseEditorContentReturnType =
  | {
      redirectionPath: string;
      textContent: string;
    }
  | undefined;

export const useAdditionalEditorMention = (_args: TUseAdditionalEditorMentionArgs) => {
  const updateAdditionalSections = useCallback(
    ({ response }: TAdditionalEditorMentionHandlerArgs): TAdditionalEditorMentionHandlerReturnType => {
      // [team 二开] @ 还能关联页面和工作项
      const sections: TMentionSection[] = [];
      if (response.page?.length) {
        sections.push({
          key: "pages",
          title: "页面",
          items: response.page.map((p) => {
            const projectId = Array.isArray(p.projects__id) ? p.projects__id[0] : (p.projects__id as unknown as string);
            return {
              icon: <span>📄</span>,
              id: p.id ?? "",
              entity_identifier: `${projectId}/${p.id ?? ""}`,
              entity_name: "page" as const,
              title: clean(p.name),
            };
          }),
        });
      }
      if (response.issue?.length) {
        sections.push({
          key: "issues",
          title: "工作项",
          items: response.issue.map((i) => ({
            icon: <span>✅</span>,
            id: i.id,
            entity_identifier: `${i.project_id}/${i.id}`,
            entity_name: "issue" as const,
            title: `${i.project__identifier}-${i.sequence_id} ${clean(i.name)}`,
          })),
        });
      }
      return { sections };
    },
    []
  );

  const parseAdditionalEditorContent = useCallback(
    (_args: TAdditionalParseEditorContentArgs): TAdditionalParseEditorContentReturnType => undefined,
    []
  );

  const editorMentionTypes: TSearchEntities[] = useMemo(() => ["user_mention", "page", "issue"], []);

  return {
    updateAdditionalSections,
    parseAdditionalEditorContent,
    editorMentionTypes,
  };
};
