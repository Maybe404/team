// [team 二开] 工作项能不能改：创建人、指派人、工作区管理员，以及拥有者批准过的共同维护人。服务端在 plane/utils/team_edit_policy.py 里同样拦截。
import { useParams } from "next/navigation";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useAccessStatus } from "@/components/team/access";
import { useUser, useUserPermissions } from "@/hooks/store/user";

export const useCanEditIssue = (issue?: { id?: string; created_by?: string | null; assignee_ids?: string[] | null }): boolean => {
  const { data: currentUser } = useUser();
  const { allowPermissions } = useUserPermissions();
  const { workspaceSlug } = useParams();
  const me = currentUser?.id;
  const direct =
    !!issue &&
    (allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE) ||
      (!!me && (issue.created_by === me || (issue.assignee_ids ?? []).includes(me))));
  // 前面几种都不是时，再问一次服务端：可能是被指定的共同维护人
  const { status } = useAccessStatus(workspaceSlug?.toString() ?? "", "issue", direct ? undefined : issue?.id);
  if (!issue) return false;
  return direct || !!status?.can_edit;
};
