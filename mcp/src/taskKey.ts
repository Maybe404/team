/** 任务编号「项目标识-序号」。Loom 的项目标识里不会有 -，所以在最后一个 - 处切开，数字、中文标识都能用。 */
export function parseTaskKey(ref: string): { identifier: string; seq: string } | undefined {
  const m = ref.trim().match(/^(.+)-(\d+)$/);
  return m && m[1].trim() ? { identifier: m[1].trim(), seq: m[2] } : undefined;
}
