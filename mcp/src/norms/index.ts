// 规范闸门：所有写入工具在调用 Loom 之前都要经过 gate()。
import { checkStyle, type Issue } from "./style.ts";
import { checkTone } from "./tone.ts";
import { checkPrivacy } from "./privacy.ts";
import { checkComment, checkTemplate, TEMPLATES, type CommentKind, type DocType } from "./templates.ts";

export { TEMPLATES, COMMENT_KINDS, type DocType, type CommentKind } from "./templates.ts";
export type { Issue } from "./style.ts";

export type GateResult = { ok: boolean; errors: Issue[]; warnings: Issue[] };

export function gate(markdown: string, type: DocType, opts: { commentKind?: CommentKind; title?: string } = {}): GateResult {
  const issues: Issue[] = [...checkPrivacy(markdown), ...checkStyle(markdown), ...checkTone(markdown)];
  if (opts.title) {
    issues.push(
      ...[...checkPrivacy(opts.title), ...checkStyle(opts.title), ...checkTone(opts.title)].map((i) => ({ ...i, message: `标题：${i.message}`, line: undefined })),
    );
  }
  issues.push(...(type === "comment" ? checkComment(opts.commentKind ?? "进展", markdown) : checkTemplate(type, markdown)));
  const errors = issues.filter((i) => i.level === "error");
  return { ok: errors.length === 0, errors, warnings: issues.filter((i) => i.level === "warn") };
}

/** 没有模板的短文本（模块、视图的名称和说明）：只查隐私、句式和 AI 味。 */
export function gatePlain(markdown: string): GateResult {
  const issues: Issue[] = [...checkPrivacy(markdown), ...checkStyle(markdown), ...checkTone(markdown)];
  const errors = issues.filter((i) => i.level === "error");
  return { ok: errors.length === 0, errors, warnings: issues.filter((i) => i.level === "warn") };
}

export function formatGate(result: GateResult): string {
  const fmt = (i: Issue) =>
    `- [${i.rule}]${i.line ? ` 第 ${i.line} 行` : ""}${i.excerpt ? ` 「${i.excerpt}」` : ""}：${i.message}`;
  const parts: string[] = [];
  if (result.errors.length) parts.push(`未通过规范检查，没有写入。请按下面逐条修改后重新提交：\n${result.errors.map(fmt).join("\n")}`);
  if (result.warnings.length) parts.push(`建议修改（按去 AI 味等规则，请逐条处理；内容已经写入的，处理后再更新一次）：\n${result.warnings.map(fmt).join("\n")}`);
  return parts.join("\n\n");
}

export const WRITING_GUIDE = `# 团队写作规范

所有通过 Loom MCP 写入的任务、评论、文档和经验都要符合这份规范。服务端会逐条检查，不符合的会被退回。

## 总原则：Agent 来写，人来看

这里的内容由 Agent 写入、检索和维护，人是受益者：人要核验 Agent 做得对不对，要从中学习，要随时查看进展。所以每一处写法都以“人能一眼看懂、能核验”为准：

- 标题就是结论或事项本身，人扫一眼标题列表就知道有什么。
- 结构固定、层次清楚：用模板里的小标题，一节只讲一件事，不写大段不分层的文字。
- 证据人能自己去验证：命令、文件路径、任务编号、链接写全，别只写“已验证”。
- 少用缩写和内部代号，第一次出现要写全称；不写只有当时对话里才懂的指代。
- 需要人做决定或审核的地方，单独说清楚要决定什么、有哪些选项。

## 基本要求

1. 结论先行：第一段或第一行直接给结论，细节放后面。
2. 写事实和证据，不写感受：说“跑了 \`pnpm test\`，42 个用例全部通过”，不说“测试情况良好”。
3. 一个意思说一次。不写引子和客套话。
4. 读者可能是人，也可能是另一个 Agent：路径、命令、编号写全，不用“上面提到的那个”。

## 图和页面：流程、架构用 mermaid，成品页用 html-embed

写文档时，流程、时序、架构、状态机这类内容画成图，比一大段文字好读。文档里有两种可渲染的块，直接写在 Markdown 里：

- 流程图：围栏代码块，语言写 \`mermaid\`，网页上会自动渲染成图，源码也保留在上面，人可以直接改。
- 整页 HTML（报表、交互原型、可视化）：围栏代码块，语言写 \`html-embed\`，围栏里放完整 HTML。网页上在沙箱里独立渲染，人可以拖拽调大小、点右上角整页放大、下载。脚本和样式写在同一个文件里，大图用外链，整块不超过 2MB。
- 写 PRD、方案时按「上面整页原型，下面逐块讲需求」组织：
  1. 先放一个完整原型：html-embed 围栏，必须写 \`name="原型.html"\`（同一篇文档里各原型 name 不能重名）。写原型时给每个要单独讲的块加 \`data-focus="名字"\`，例如 \`<div data-focus="优惠券">\`。
  2. 每条需求先写一两句话，再放一个局部块，再写这块的规则和验收。局部块的围栏里留空，只写属性：\`\`\`\`html-embed ref="原型.html" focus="[data-focus=\\"优惠券\\"]"\`\`\` 加一行闭合围栏。focus 里的引号按 JSON 转义。
  3. 可选属性：\`mode=spot\`（整页保留、其余压暗，适合要对照上下文时）、\`follow=false\`（不把点开的下拉、弹层一起显示）、\`lock=false\`（压暗区域仍可点击）。默认只显示这一块，读者可点「整页」看全貌，页面里的操作状态不丢。
  4. 原型只存一份，局部块只是引用它；改原型一处，所有局部块都跟着变。局部块的 focus 必须在原型里存在，写入前会检查，不存在会被退回。read_doc 读到的 Markdown 里这些围栏原样出现，全文改写时原样保留。
  5. 弹层如果离被讲的元素很远（比如居中的对话框），不会自动跟着显示，把对话框也写成一个单独的局部块。
  6. 人在网页上也能做：完整原型块上点「拆出局部」，到原型里点选一块，自动生成局部块；这种块带 id 属性，MCP 读写时原样保留。
- 图文排版：先用一两句话讲这张图要说明什么，再放图，图下面是图注（svg 围栏的 caption、位图的说明文字会自动变成图注）。图默认居中，宽度占正文栏的 60%–80%，细节多的图用 100%（正文栏宽 725px）；一屏里不要连放好几张图，每张图前面都要有一句话交代。
- SVG 图：围栏代码块，语言写 \`svg\`，围栏里放 SVG 源码（可加 \`name="架构.svg" width=80% caption="图 1：整体架构"\`）。写入时会自动上传成文档图片，网页上点图可放大。SVG 里不能有 script、事件属性和 foreignObject，会被拒绝。
- PNG 等位图：写成 \`![说明](data:image/png;base64,……)\`，支持 PNG、JPEG、GIF、WebP，单张不超过 5MB。Agent 手上有图片文件时先转成 base64 再写；能画成 SVG 或 mermaid 的优先用它们，比位图清晰、体积小、人也能改。
- 表格和图片的宽度：不用自己设。写入时服务端按内容给每列定宽（总宽不超过正文栏，太窄的表会适当拉宽），图片按原图尺寸定宽，居中显示，读不出尺寸时按正文栏的 70%；想指定就写 svg 围栏的 width（如 width=80%），或 \`![](asset:… "80%||center")\`，也可以直接写像素（\`"580px||center"\`）。编辑器内部按像素存宽度，写入时服务端会把百分比折成像素，所以读回来看到的是像素值，这是正常的。表格总宽不超过正文栏，内容少的窄表会比正文栏窄，不会铺满；想铺满就多加一两列内容或把它放进更宽的结构。表格控制在 7 列以内、单元格里只放短句，长说明放正文；一格里放多句话说明该拆表或改成列表。位图宽度至少 800px，太小的截图会糊，别硬放大。
- 搜索：新建文档、任务之前先用 search 搜一遍关键词，已经有的就更新或关联，不要重复新建。
- 验证：存进去的值和网页显示效果是两回事。图片大小、表格布局这类效果，你只读回 Markdown 是看不出来的；打不开网页时要如实告诉用户“显示效果未验证，请你看一下”，不要写“已改好”。
- 令牌：每个人用自己的 API Token，不要共用，否则版本历史、动态里的作者就不是真实的人。
- 版本：改写已有文档前不用手动备份，write_doc 会自动留版本；要大改或重写整篇，先 doc_versions action=save 并写 label 说明，重要的基线版本再 lock。回退用 doc_versions action=restore，别用旧内容覆盖。没有编辑权限时用 doc_access 申请，别换办法硬改。
- 层级和引用：知识库按主题分层，不要把所有文档平铺。写新文档前先 list_docs 看现有的树，相关内容挂在对应的主题页下面（write_doc 的 parent_id），没有合适的主题页就先建一篇概述页再往下挂。正文里引用另一篇文档有两种写法，都是 \`[📄 标题](page:<文档ID>)\`：单独占一行，网页上是 Notion 风格的子页面块（图标加下划线标题，点击跳转），适合列出子页面和目录；写在句子中间，网页上是行内的 @ 页面标签，适合行文里提到某篇文档。新建子文档用 write_doc 的 parent_id，不需要先建再移。目前 MCP 只能 @ 页面；@ 人和 @ 工作项要在网页上做，工作项关联用 write_doc 的 task 参数或 link_doc。
- 全文改写已有页面前先 read_doc：页面里已有的 html-embed 块和图片会原样出现在返回的 Markdown 里（图片是 \`![](asset:…)\`），改写时原样保留，删掉就等于从文档里删除。

## Markdown 支持范围（写入前看一眼，不用去翻前端代码）

write_doc 的正文按 CommonMark 加 GFM 解析，网页编辑器能原样渲染的有：

- 标题（# 到 ####）、粗体、斜体、删除线、行内代码、链接、分割线。
- 有序和无序列表、任务列表（\`- [ ]\` 和 \`- [x]\`）、嵌套列表。
- 表格（GFM 语法，列宽写入时自动定）。
- 引用块：\`> 内容\`，可以多段、嵌套。
- 提示块（带图标和底色，像 Notion 的 callout）：\`> [!NOTE]\`（蓝，备注）、\`> [!TIP]\`（绿，建议）、\`> [!IMPORTANT]\`（紫，重点）、\`> [!WARNING]\`（橙，警告）、\`> [!CAUTION]\`（红，危险）。标记后面可以接一句标题，下面几行继续用 \`> \` 写正文。读回来仍是这个写法。需要每轮对话、每个结论做成醒目卡片时用它，别用引用块硬凑。
- 代码块（带语言）、mermaid 流程图、html-embed、svg 和位图、\`[📄 标题](page:ID)\` 页面链接、@姓名。

不支持，写了不会变成对应的块，会退化成普通文字或被丢掉：

- \`<callout>\`、\`<details>\`、\`<p color>\`、\`<div style>\` 这类 HTML 包装，正文里的原始 HTML 会被清理，别用它排版。
- 数学公式（\`$…$\`、LaTeX）、脚注、文字颜色和字体大小、多栏、折叠块。公式用文字描述，或画成 svg 图。
- 想要整页自定义排版，用 html-embed 围栏，不要在正文里混 HTML。

写完不确定渲染效果时：read_doc 读回来，提示块应当还是 \`> [!NOTE]\` 形式、表格还是表格，读回来变样就说明没被识别；你没有网页登录时不用去查前端代码，按这一节写即可。

## 去 AI 味

句式检查用第三方 skill「去 AI 味 v2」（lieflat-less-ai-tone，CC BY-NC 4.0，规则基于 629 篇对照和 270 对配对实测）。完整说明见资源 \`team://skills/less-ai-tone\`。

会被拒绝的（两轮实测同向、改动不碰语义）：

- 翻案腔：先立一个读者没有的误解再推翻。「不是……而是……」「与其说……不如说……」。直接正面下判断。
- 提示语冒号：「一句话总结：」「核心是：」「原因如下：」。删掉提示语直接写，前半句承接上文时只换标点。
- 起手式：「说白了，」「说穿了，」「先说结论，」。删掉。

会提示、不阻止的：「当……时，」前置从句、「对于……来说」话题壳、段首「然而，/因此，/此外，」、一句里三项以上顿号并列、过长前置定语、破折号过密。

不要为了"像人写的"去改这些（实测不是 AI 味）：序数词小标题、「这意味着」、冒号引出列表、「首先/其次」、「赋能/闭环」这类词、句长长短。

另外，文档里不出现对话助手的残留：

- 客套话：「希望对你有帮助」「如有问题请随时联系」「让我们深入探讨」
- 模型自述：「作为 AI」「我为你……」「以下是……的总结：」
- emoji
- 大量加粗：每千字不超过 8 处，只给关键结论加粗

## 隐私

团队空间里所有成员都能看到，写之前确认内容属于团队工作。服务端会拦：

- 密钥：API Key、Token、私钥、明文密码。用占位符（例如 \`<API_KEY>\`），真实值放本机环境变量。
- 个人信息：手机号、身份证号、银行卡号。
- 本机文件：指向本机的图片和文件链接。需要的图片在 Loom 网页上传。
- 本机绝对路径（提示）：改成仓库内的相对路径。

私人项目、私人笔记、和团队无关的内容不要写进来；私人经验用 propose_lesson 的 scope=private，只存在本机。

## 格式

- 正文从二级标题（##）开始，标题单独传入，不要在正文写一级标题。
- 标题层级不跳级。
- 中文句子用全角标点；代码、命令、路径、字段名用反引号。
- 不用感叹号。

## 各类文档

${Object.values(TEMPLATES)
  .map(
    (t) =>
      `### ${t.name}（type: \`${t.type}\`）\n\n${t.purpose}。${
        t.required.length ? `必填章节：${t.required.map((s) => `「${s.title}」`).join("、")}。` : ""
      }${t.optional?.length ? `可选章节：${t.optional.map((s) => `「${s.title}」`).join("、")}。` : ""}${
        t.minChars ? `至少 ${t.minChars} 字。` : ""
      }`,
  )
  .join("\n\n")}

## 任务评论

评论第一行是一句话结论，后面写细节。类型有：进展、结论、阻塞、决策、验收、派发、审查。
“结论”和“验收”必须写验证证据（命令和结果）；没跑的检查写“未运行”。
`;

export function templateGuide(type: DocType): string {
  const t = TEMPLATES[type];
  return `# ${t.name}模板（type: ${t.type}）\n\n用途：${t.purpose}\n\n${
    t.required.length ? `必填章节：\n${t.required.map((s) => `- ${s.title}：${s.hint}`).join("\n")}\n\n` : ""
  }${t.optional?.length ? `可选章节：\n${t.optional.map((s) => `- ${s.title}：${s.hint}`).join("\n")}\n\n` : ""}骨架：\n\n\`\`\`markdown\n${t.skeleton}\`\`\`\n`;
}

export const LESSON_GUIDE = `# 哪些内容该沉淀为经验

经验库是团队下次遇到同类事时的“先看一眼”，也是人审核、学习的地方。收得杂，大家就不看了，所以宁缺毋滥。每条经验提交前对照下面几条。

## 值得沉淀（要同时满足前三条）

1. 可复用：以后会在别的任务里再遇到，不是这一次的特例。
2. 不明显：看代码、读文档、看报错信息一眼得不到，是踩过坑或查了很久才知道的。
3. 有代价：不知道会白白花时间、出线上问题或返工。
4. 已验证：你亲自试过，或者有明确来源（任务、文档、报错），不是猜测。

典型的好经验：
- 某个工具、框架的坑和绕开的办法（例如“Caddy 里 reverse_proxy 不要把两个路径写在同一行”）。
- 团队约定的做法和原因（例如发布前要先跑哪个检查）。
- 一次事故或返工复盘后得出的具体规则。

## 不要提交

- 任务进展、一次性的结果、某天的状态：写在任务评论里。
- 能从代码、README、官方文档直接查到的事实。
- 个人偏好、个人环境配置、私人笔记。
- 没验证的猜测、“可能是”“感觉”。
- 太宽泛的大道理（例如“写代码要仔细”）：没法照着做就不是经验。
- 和已有经验重复的：先 search_lessons（带 include_pending）查一遍，有相近的就不要再提，提示用户去补充那一条。
- 密钥、个人信息。

## 归属哪个项目

经验要和项目对得上，方便按项目查、按项目审：

- 默认归当前仓库关联的项目，不用额外传参；仓库关联了多个项目时用 project 指定。
- 不属于具体项目的经验（工具和框架的通用坑、临时记下来先累积的）传 project=通用。
- search_lessons 默认只看当前项目加上通用的，要看全部传 all_projects=true。
- 在网页上，经验带有「项目:XXX」或「通用」标签，可以直接按它筛选。

## 怎么写，让人一眼看懂

- 标题是一句可执行的规则或结论，带上对象，例如“脚本解析 Django shell 输出前要过滤提示行”，不写“关于 Django 的一些经验”。
- 一条经验只讲一件事。两件事就拆成两条。
- 用模板：场景（什么时候会遇到）、做法（照着做就行，命令和路径写全）、原因（为什么）、来源（来自哪个任务或文档，人靠它核验）。团队经验必须有来源。
- 标签选已有的，不要为一条经验新造标签；标签看起来要像目录，例如 部署、django、安全。
- 提交前征得用户同意，并告诉用户这条为什么值得沉淀。
`;

/** 代码检查之外，让 Agent 自己再过一遍的清单：规则查不到的（人能不能看懂、语义层的 AI 味）靠它。 */
export const SELF_CHECK =
  "提交前自检：①标题和第一句是结论吗 ②人不看上下文能看懂吗 ③命令、路径、编号写全了吗 ④有没有翻案腔、套话、空泛形容词（去 AI 味）⑤有没有密钥和个人信息";
