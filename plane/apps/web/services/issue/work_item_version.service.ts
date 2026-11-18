/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
import { EIssueServiceType } from "@plane/types";
import type { TDescriptionVersionsListResponse, TDescriptionVersionDetails, TIssueServiceType } from "@plane/types";
// helpers
// services
import { APIService } from "@/services/api.service";

export class WorkItemVersionService extends APIService {
  private serviceType: TIssueServiceType;

  constructor(serviceType: TIssueServiceType = EIssueServiceType.WORK_ITEMS) {
    super(API_BASE_URL);
    this.serviceType = serviceType;
  }

  async listDescriptionVersions(
    workspaceSlug: string,
    projectId: string,
    workItemId: string
  ): Promise<TDescriptionVersionsListResponse> {
    return this.get(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${workItemId}/description-versions/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // [team 二开] 保存快照、命名、锁定
  async saveSnapshot(
    workspaceSlug: string,
    projectId: string,
    workItemId: string,
    payload: { label?: string; lock?: boolean; source?: "before-restore" } = {}
  ): Promise<{ id: string }> {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${workItemId}/description-versions/`,
      payload
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateDescriptionVersion(
    workspaceSlug: string,
    projectId: string,
    workItemId: string,
    versionId: string,
    payload: { label?: string; is_locked?: boolean }
  ): Promise<unknown> {
    return this.patch(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${workItemId}/description-versions/${versionId}/`,
      payload
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async retrieveDescriptionVersion(
    workspaceSlug: string,
    projectId: string,
    workItemId: string,
    versionId: string
  ): Promise<TDescriptionVersionDetails> {
    return this.get(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${workItemId}/description-versions/${versionId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
