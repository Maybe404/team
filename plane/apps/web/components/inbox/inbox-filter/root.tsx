/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { FilterOutline } from "@makeplane/propel/icons";
// plane imports
// components
import { FiltersDropdown } from "@/components/issues/issue-layouts/filters";
// hooks
// local imports
import { InboxIssueFilterSelection } from "./filters/filter-selection";
import { InboxIssueOrderByDropdown } from "./sorting/order-by";

// 收集列表是窄栏，筛选只显示图标，避免挤压左边的「未处理 / 已处理」
const smallButton = <FilterOutline className="size-3" />;

export function FiltersRoot() {
  return (
    <div className="relative flex items-center gap-2">
      <div>
        <FiltersDropdown menuButton={smallButton} title="" placement="bottom-end">
          <InboxIssueFilterSelection />
        </FiltersDropdown>
      </div>
      <div>
        <InboxIssueOrderByDropdown />
      </div>
    </div>
  );
}
