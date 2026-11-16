// [team 二开] 工作项只有创建人、指派人和工作区管理员能改，其他成员只能评论。服务端在 plane/utils/team_edit_policy.py 里同样拦截。
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useUser, useUserPermissions } from "@/hooks/store/user";

export const useCanEditIssue = (issue?: { created_by?: string | null; assignee_ids?: string[] | null }): boolean => {
  const { data: currentUser } = useUser();
  const { allowPermissions } = useUserPermissions();
  if (!issue) return false;
  if (allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE)) return true;
  const me = currentUser?.id;
  return !!me && (issue.created_by === me || (issue.assignee_ids ?? []).includes(me));
};
