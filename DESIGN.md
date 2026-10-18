# 2pi 设计

2pi 是基于 pi 二次开发的科研写作 agent：一个与领域无关的内核，加两个领域包：paper（移植自 research2paper）和 patent（原 p2p）。分阶段计划见 [ROADMAP.md](ROADMAP.md)。

原则：**LLM 自主决策，不写死工作流**。2pi 只提供领域知识、专用工具、安全边界、检查点和"交付前必须检查"的关卡；做什么、按什么顺序、何时回头修改，由模型决定。

## 1. 基于 pi 的方式

调用 pi 的 `main(args, { extensionFactories })`，注入 2pi 扩展，不 fork pi。pi 的交互 TUI、打印/JSON/RPC 模式、会话持久化与分叉、上下文压缩、多 provider 与 `/login` 全部复用。

登录与模型配置与 pi 原生一致，只有名字不同：配置目录 `~/.2pi/agent`（`auth.json`、`models.json`、`settings.json` 格式与 pi 相同），pi 的 `PI_*` 进程变量在 2pi 中叫 `TWOPI_*`（启动前转成 `PI_*` 交给 pi，见 `core/config.ts` 的 `PI_VARIABLES`），`2pi --help` 与子命令帮助中 pi 的文字被换成 2pi 的名字（`core/branding.ts`）。`2pi update` 拦截 pi 的自更新（2pi 从自己的仓库更新）。

| 扩展点 | 2pi 用来做什么 |
|---|---|
| `before_agent_start` | 替换系统提示词（分层，见 §3），过滤上下文文件与技能 |
| `registerTool` | 内核工具与领域工具 |
| `tool_call` | 写保护、命令审批，记录看过的图片 |
| `tool_result` | 领域包跟踪本轮改过的交付物 |
| `agent_before_settle` | 交付前检查：领域包自动检查 + 待办提醒，必要时续跑修复轮 |
| `before_agent_start` / `agent_settled` | 每轮前后的文件检查点与修改记录 |
| `registerCommand` / `registerFlag` | `/init` `/paper` `/patent` `/review` `/plan` `/undo` `/changes` `/redline` `/checkpoints`，`--full-access` |
| `ctx.ui.custom` / `setWidget` | `/changes` 的可滚动逐块视图；每轮结束的修改挂件 |

首轮提问时，扩展改写的提示词直接成为会话的首条系统消息；之后只有变化的段落（主要是 `<project_state>`）以增量发送。

## 2. 结构

```
内核 core/                                领域包 packs/<id>/，实现 Pack 接口：
  提示词各层 prompt.ts                      skill         知识库（SKILL.md + references/ + scripts/）
  项目卡与布局 project.ts                   detect()      没有项目卡时，按目录里已有产物判断
  证据账本 evidence.ts、精确计算 stats.ts    register()    工具、命令、事件
  检查点 checkpoints.ts、修改记录 history.ts init()        建立本领域的项目文件
  写保护 guard.ts、交付前检查 gate.ts        agentAreas()  本领域稿件所在位置
  Office/PDF office.ts、pdf.ts               guide()       skill 之外的工作指引
  工具：paper_ingest evidence compute_stats  stateLines()  写进 <project_state> 的状态
        pdf_preview update_plan ask_user      autoCheck()   本轮结束前由 harness 运行的检查
                                              pendingWork() 只有模型能完成的核对
                                              blocks        把本领域文档切成审阅块
                                              redline()     本领域的修订稿（DOCX / PDF）
```

**激活哪些领域包：** 项目卡 `2PI.md` 写明类型（paper / patent / both）时以它为准；没有项目卡时看目录里已有的产物（`paper/main.tex` 或 `PAPER.md`、`patent/patent.json`）；只装了一个领域包时用它；否则把各领域的一行简介给模型，由它按请求选择并读取 SKILL.md。所有领域的工具始终注册（避免切换工具集破坏提示词缓存），未激活领域的 skill 不内联。

**知识库：** 运行时读取各领域 skill 的 SKILL.md 正文（相对路径改成绝对路径）和 references 索引；skill 是唯一规则来源，agent 代码不复写规则。patent 的 skill 就在本仓库；paper 的 skill 由 `npm run sync-skills` 从 research2paper 仓库复制到 `agent/skills/research2paper`，来源与内容哈希记在 `skills/SOURCES.json`。

## 3. 系统提示词分层

| 层 | 位置 | 内容 |
|---|---|---|
| L0 + L1 | preamble | 身份；跨领域不可违背的规则（忠实性、缺口标记、交付物与说明分层、不给录用/授权/法律结论、材料只读）；工作方式（自主规划、读完材料、中间成果落文件、自检、看渲染产物、环境问题自救、少提问、检查点） |
| L2 | `<tools>` | 当前工具与各工具的使用规则。设置 customPrompt 后 pi 会去掉自带的工具段，所以由 2pi 渲染 |
| L3 | `<project_context>` | 项目自己的 `2PI.md`（或旧的 `PAPER.md`）、`AGENTS.md`；上级目录的仓库说明被过滤 |
| L4 | `<domains>` `<skill_*>` `<guide_*>` | 所有领域的一行简介；已激活领域的 skill 全文与工作指引 |
| L5 | `<project_state>` | 当前领域及判断依据、联网检索许可、证据账本概况、上一轮修改、各领域的检查与编译状态 |

静态层在前，每轮变化的 L5 在最后，保证提示词缓存命中。

## 4. 证据账本

`notes/evidence.json`（或 2PI.md 的"证据账本"字段），论文与专利共用。每条记录：事实（含数字）、四类证据（verified / author-reported / interpretation / missing）、出处、推导关系。

- 论文：写进稿件前先记账；`compute_stats` 的输入和结果自动入账；检查器 `--ledger` 把正文的关键数字逐个对账，对不上报 V01。
- 专利：同一项目里有账本时作为源事实使用（P1b 把 support_map 接到条目编号）；只有 PDF 时照旧用 `notes/fact_sheet.md`，不强制建账。
- 已知限制：V01 只核对数字，不核对技术特征；出处由模型填写，是否属实仍需作者核对。

## 5. 工具

| 工具 | 归属 | 作用 |
|---|---|---|
| read write edit bash | pi | 读写文件、看图、运行命令 |
| paper_ingest | core | PDF/DOCX/TeX/MD/TXT → `.2pi/sources/<名>/`：带 `[[page N]]` 的全文、页面图像、图表与章节索引、公开状态线索；原件转为只读 |
| evidence、compute_stats | core | 证据账本；精确计算（可读 CSV 单元格，结果自动入账） |
| pdf_preview | core | 渲染 PDF 页面给模型看（pdftoppm / mutool / Ghostscript） |
| update_plan、ask_user | core | codex 风格计划；人在回路提问（无界面时按保守假设继续并写进说明） |
| paper_init、check_draft、latex_compile、fill_gaps、bib_lookup | paper | LaTeX 骨架（article/elsarticle/ieeetran）；检查器；tectonic/latexmk 编译与日志解析；用作者提供的值填补缺口；Crossref 核对参考文献（只读） |
| patent_check、patent_build | patent | 形式自检；附图 → 申请文件与撰写说明 DOCX → PDF 与预览页（LibreOffice，Windows 上可用 Word） |

## 6. 交付前检查

模型准备结束一轮时（`agent_before_settle`）：

1. 每个领域包运行 `autoCheck`：paper 编译本轮改过的 LaTeX 项目并检查改过的稿件（含账本对账），patent 检查改过的 patent.json，并持续报告仍有 ERROR 的草稿。
2. 收集 `pendingWork`：只有模型能完成的核对，例如专利附图与预览页还没看。
3. 有错误或待办时注入报告并续跑一轮修复；每次用户请求最多两轮，用完后如实报告剩余问题。只有提醒且内容未变时不重复。WARN 不触发修复轮。

这把 research2paper 的"harness 自动编译与检查"与 p2p 的"提醒查看渲染产物"合并成一个关卡、一份预算。

不启动修复轮的报告（只有 WARN）在 print 模式（`2pi -p`）下不追加：pi 的 print 模式只在会话最后一条是助手消息时输出它，追加在答复之后的报告会让输出变空。交互界面、JSON 与 RPC 模式照常显示。

## 7. 检查点与修改记录（改动可视化的地基）

- 影子 git 仓库 `.2pi/history`：GIT_DIR 显式指定，工作树是项目目录，从不触碰用户自己的仓库；`.2pi/.gitignore` 内容为 `*`。排除 `.2pi/`、`build/`、`preview/`、Word 锁文件，以及超过 20 MB 的新文件；目录文件超过 5000 个时整体关闭。
- 每轮开始先存一次（记录用户两轮之间的手动修改），结束再存一次；两次之间有差异就写一条修改记录 `.2pi/changes/cNNNN.json`（请求、前后检查点、每个文件的状态与增删行数）。
- `/undo` 只恢复那一轮改过的文件；这些文件之后又被改过时视为冲突，默认跳过，`/undo force` 才覆盖。撤回本身也是一条修改记录。
- 修改记录是所有改动视图的共同输入：TUI 挂件与 `/changes`、HTML 审阅页、修订稿，以及 P4 的编辑器扩展。

## 7a. 块级改动与修订稿（P2）

- **块模型**（`core/blocks.ts`）：块 = 审阅者心里的单位，`{id, title, text}`。领域包提供提取器：专利 JSON 按申请文件顺序切成发明名称、摘要、`claims/n`、`description/<节>/<段>`（公式、表格转成可读文本）、`drawings/<n>`、撰写说明（support_map、gaps、notes），生成字段 `drawing_assets` 不算；LaTeX 按空行分段，标题取上方最近的 `\section`/`\subsection`。内核自带证据账本（按条目）与 Markdown/纯文本（.md .txt .rst .bib，按段）。其他文本文件（生成的 SVG、数据、代码）不逐块比较，和二进制文件一起列为"其他文件"。
- **对齐**（`core/blockdiff.ts`）：块序列用 LCS 对齐，相同内容作为锚点，所以插入一项权利要求只标它自己；锚点之间成对的删除与新增在词元相似度 ≥ 0.2 时算"修改"，否则算删除 + 新增。块内是字词级差异：中文逐字，英文按词；随后做语义合并（同 diff-match-patch：夹在两处改动之间、不长于两侧改动的未改片段并入改动），改写读起来是成片的短语。
- **变更集**：每轮结束时从前后检查点算出改动块（`blocks`：文件、块、标题、操作、前后文本、原因），连同模型的 `summary` 和没对上块的原因（`notes`）写进 `cNNNN.json`。视图只读变更集和检查点，不再各自算 diff。
- **原因**：`report_changes(summary?, reasons[{target, why}])` 在本轮进行中就能调用、可多次调用（补充原因时省略 summary，保留之前的总结），返回本轮所有改动块及各自的原因，方便模型对齐名称再补。target 分三级：块（标题或编号精确匹配，其次后缀，如"具体实施方式 第3段"）、节（标题前缀，如"说明书·发明内容""权利要求"，数字不连写，"权利要求1"不匹配"权利要求10"）、文件；越具体的原因越优先，所以模型可以先给整个文件一个原因，再逐块细化。精确匹配优先，避免"权利要求1"误挂到"支持关系·权利要求1"。
- **提醒而不强制**：一轮修订了**已存在**的稿件（领域包能切块的文件，且确有块变化）却一次也没调用 `report_changes`，交付前检查把它列为待办，占用同一份两轮修复预算；新写的稿件不要求说明（请求本身就是理由），构建只刷新生成字段时也不要求。
- **渲染器**：`/changes` 用 pi-tui 的自定义组件做全屏滚动视图（主题色：删除划线、新增下划线）；无界面时输出 `[-删-]{+增+}` 文本。`/redline` 与 `redline` 工具为一轮或一段轮次生成 `.2pi/review/<编号>/`：`review.html`（自包含、跟随系统明暗主题、未改动段落折叠在 `<details>` 里），专利 `*-redline.docx`（整份申请文件，改动为 `w:ins`/`w:del` 修订、原因为批注、打开即处于修订模式），论文 `paper-redline.pdf`（两个版本从检查点还原到临时目录，`latexdiff --flatten` 后按论文的引擎编译，项目目录不受影响）。

## 7b. 调研与引用核验（P3）

- **辅助领域包**：research 不是项目类型，而是为 paper 和 patent 服务的 `auxiliary` 包：项目卡允许联网检索、已有 `research/` 或调研库时启用（skill 全文进提示词），否则只在领域列表里给出 SKILL.md 路径，提示词要求涉及调研时先读它。写作规则在 2pi 自有的 `agent/skills/research`（检索策略、调研报告模板、现有技术检索与对比文件候选表），不改 paper2patent skill，也不改同步来的 research2paper skill。
- **联网层**（`core/online.ts`）：统一的请求与重试（429/503 退避，遵守 Retry-After）、User-Agent 不含个人信息、可替换的 fetch（测试用脚本化响应）。授权：项目卡"联网检索：允许"，或终端界面里本会话确认一次；无界面时直接拒绝并让模型告诉用户。每次请求追加到 `.2pi/research/searches.jsonl`（工具、服务、检索式原文、结果数或错误）。bib_lookup 沿用原行为（只发参考文献元数据，不需授权）。
- **来源**：文献——OpenAlex（`title_and_abstract.search` 过滤，比全文检索噪声小；免费额度按天计量，失败时自动改用 Crossref 并记录两次尝试）、arXiv（Atom）、Crossref；专利——EPO OPS（OAuth 客户端凭证，CQL；JSON 结构有单项不包数组、`$` 取值等特点，解析做了容错，**未用真实账号验证**）。未配置专利服务时 `patent_search` 不联网，只生成 Google Patents / Espacenet 链接；`patent_import` 按列名识别 Google Patents、Espacenet 和另存为 CSV 的国知局导出。
- **调研库**（`.2pi/research/library.json`）：检索、获取、导入到的文献与专利，按 DOI / arXiv / OpenAlex 编号或公开号去重合并；bib_lookup 在 Crossref 确认存在的 DOI 和它给出的候选也入库。
- **引用核验**（防"凭记忆写编号"）：research 包跟踪本轮 write/edit 的 .md/.tex/.bib/.json/.txt（不含 `.2pi/` 与 materials/），交付前抽出其中的 DOI、arXiv 编号和专利公开号（公开号比较时去掉分隔符与种类代码；arXiv DOI 与 arXiv 编号视为同一篇）。已知集合 = 调研库 ∪ 作者材料与已解析论文中出现的编号（作者提供的即视为作者担保）。其余的报为"引用核验"并启动修复轮；同一行（.bib 为同一条目）写明"待核实"的视为已声明，不再报告。
- **命令行联网**：项目卡未允许时，curl / wget / Invoke-WebRequest / `python -c` 中的 HTTP 调用需要确认（无界面时拒绝）；允许时照常执行但记入检索日志。运行脚本文件发出的请求识别不了，只靠指引约束。
- **全文**：`lit_fetch` 先试开放获取链接，再打开文献页面找 `citation_pdf_url`；拿不到就要求依据摘要并注明，不让模型自己写抓取脚本。
- **刻意不做**：不判断新颖性/创造性；不抓取 Google Patents 等无公开 API 的网站。

## 7c. 终端界面

pi 的默认工具行是彩色底框加最多 10 行输出预览，长任务里几十个这样的框把模型的说明淹没了。2pi 只用扩展 API 改样式，不修改 pi：

- `pi.registerToolRenderer` 为所有工具（内置与 2pi 的）返回 `renderShell: "self"` 的渲染器：一行"状态 · 动作 · 对象 · 结果摘要 · 用时"。结果摘要在 `renderResult` 里算出并写进同一行的共享 `state`，行组件在绘制时读取。出错时在下面列出最能说明原因的至多 3 行（含 `!`、error、No such 等的行，否则最后几行）。展开（`ctrl+o` 或点击）时委托给原工具的 `renderResult`，看到的就是 pi 原来的完整内容。
- `registerMessageRenderer("2pi-gate")`：交付前检查只显示标题行（各项计数与修复轮状态），展开显示全文；不再用紫色底框。
- `ctx.ui.setHeader` 换成 2pi 的启动标题（`ui/banner.ts`），标识的做法照搬 codex 的欢迎动画（`codex-rs/tui/src/empty_state_animation`）：在三维中描述图形，按法线用 codex 的 `Lighting::shade`（主光、阴影、补光、轮廓光、高光，浅色终端改为前景色单色）着色，前向投影到点阵并做深度测试，每个盲文字符取其中各点的平均色（`ui/logo.ts`）。图形是一本摊开的书：两页做成从书脊卷起的曲面，只画出轮廓线（压暗，作为背景）；"2π"是一条 Catmull-Rom 笔迹，宽笔尖使竖画粗、横画与连笔细，按到笔迹的距离场做成凸起、有倒角的带状曲面，边缘的法线外倾，因此左上受光、右侧出现青色轮廓光。笔迹在左页写"2"，底笔跨过书沟直接升成右页"π"的左腿，经横画在末端折返成右腿，一笔不断。与开合角度无关的采样（距离场与法线）按尺寸缓存，每帧只做旋转与投影（约 0.6 ms），所以启动时书可以从书脊处打开（绕书脊旋转书页，约 1.1 秒）；静止后按宽度缓存输出。旁边的文字按 codex 头部的样式：粗体名称、灰色版本，下面是模型与思考强度（随 `model_select` / `thinking_level_select` 更新）、目录与领域。计划与本轮修改挂件改为带主题色的组件（非终端界面仍是纯文本）。
- 首次启动写入 2pi 配置目录的默认设置（`quietStartup: "header"`、`hideThinkingBlock`、`showImages: false`，以及第 2 版加入的 `retry`），只补缺失项；版本标记记录已应用到哪一版，新版本只补自己新增的项，从不改 `~/.pi`。
- `TWOPI_CLASSIC_UI=1` 关闭以上全部。测试用 pi 真实的 `ToolExecutionComponent` 渲染，pi 升级改了渲染接口时会失败。

**左右分栏**（`ui/split.ts`）。pi 的全屏模式（`TuiAltScreen`）自己组装布局根：transcript 的 `ScrollView` 加底部输入区的 `VStack`，扩展 API 没有替换布局的入口。2pi 从标题工厂拿到 TUI，读取渲染器当前的布局根，把它换成 `VStack[ SplitRow[transcript │ 分隔线 │ 面板], 输入区 ]`：组件仍是 pi 自己的（transcript 照常跟随输出、搜索、滚动），输入区与状态栏保持全宽。`SplitRow` 直接实现 pi-tui 的布局节点协议（`Symbol.for("@earendil-works/pi-tui/layout-node")`），每帧按终端列数算出精确列宽——pi-tui 的 grow 权重按贪心分配余量，7:3 在 120 列下会分成 105:14。分隔线按下时捕获鼠标，拖动按 `screenX / 列数` 改比例（限制左栏 ≥ 44 列、右栏 ≥ 28 列），松开时把偏好写入 `<agent-dir>/2pi.json`（不写 pi 的 settings.json，避免与 pi 并发写同一文件）。pi 切换 TUI 模式会重新设置布局根，面板的 70 ms 帧计时器发现根被替换就再包一次；常规模式与窄于 90 列的终端保持单栏。依赖 pi-tui 的两处内部细节（渲染器的 `layoutRoot` 字段、`VStack` 的 `entries`），结构不符时退化为把整个根放在左栏。

**流程面板**（`ui/flow.ts`）。2pi 不写死工作流，所以面板不是固定流程图，而是两种视图，`F3`、`/panel track|tree` 或点击面板底行切换，选择写入 `2pi.json` 的 `flowView`。`nodeForTool` 按工具名和路径把每次调用归到步骤（写 `.tex` 归"撰写论文"、`bash` 里跑 latexmk 归"编译 PDF"、看图片归"核对渲染"；翻阅材料、读代码这类通用操作不点亮步骤，只出现在顶部的"正在做什么"里）。每次到达一个新步骤记入本轮轨迹；从后面的步骤回到前面的步骤（轨道顺序变小）就是一次回环：按"离开的步骤 → 返回的步骤"聚合计数，并让"本遍"从返回处重新开始。

*步骤轨道*（默认）：项目领域通常经过的步骤按惯常顺序挂在请求下面（`STAGES`，每步标明属于哪些领域和哪个分组），会话中用到的其他步骤随时加入；论文、专利的步骤各成一组，这一轮在别的分组工作而没碰到的分组自动折叠成"▸ 论文 4/4 ✓"一行，点击分组行可以手动展开或折叠（到下一轮为止）。本遍已到达的最远步骤以上是实线分支，以下是点线分支；正在做的步骤下列出最近三次调用（进行中的在后）。回环不再画弧线：离开的步骤若仍是失败状态，就在它的说明后面标"↺ 返回的步骤"；它之后通过了，这条回环就移到轨道下方的列表里。返回的步骤旁标经过次数，它之后、本遍还没重新走到的步骤变暗；上一轮的结果同样变暗但保留。说明靠右对齐，放不下时先截断说明。

*树状图*：本轮的生长过程。请求是根；每到一个步骤，在当前节点下长出一个子节点；回头时从当前路径上最后一个惯常顺序先于目标步骤的节点分叉（"形式检查 → 撰写专利"从第一次"撰写专利"的父节点分出新枝），没走通的枝保留并变暗。布局是自上而下的居中树：每棵子树占它最宽一行的列数，父节点居中于首末子节点之上，连线按每格连通的上下左右方向选圆角制表符。放不下时，当前路径以外的节点缩成只剩符号；仍放不下就以当前节点为中心裁切。一行可能有几个节点，所以点击按行和列定位。

新到达的步骤，其分支（树中是连到它的边）高亮约 0.7 秒。状态来自扩展事件（`before_agent_start`、`tool_execution_*`、`message_update`、`ui_prompt_*`、`agent_settled`），交付前检查与断线重连通过回调上报；工具行与面板共用 `describeCall` / `describeResult`，两处措辞一致。点击步骤在浮层中列出它的调用历史和相关回环。模型本身是纯数据加字符串渲染，测试不需要终端。

**断线重连**（`core/reconnect.ts`，对应 codex 的 `responses_retry.rs`）。codex 分两层：有界的请求/流重试（默认流重试 5 次、指数退避带抖动、遵守 Retry-After），以及连接失败时不计次数地"等待网络"（5 秒起翻倍到 60 秒）。第一层 pi 已有（agent 级 `retry`），2pi 只把默认次数调到 5；第二层由 2pi 在 `agent_before_settle`（结局为 error）里实现：错误信息属于连接失败才等待（额度、鉴权、请求无效直接结束），用 TCP 连接探测模型服务主机或代理，恢复后返回 `context_edit`（把失败的那次回复从上下文中去掉，与 pi 自身重试的做法一致，否则末条是 assistant、无法续跑）和 `continue: true`。注意 `emitBoundary` 中后一个处理器返回的 `entries` 会替换前一个的，所以这里在 `event.entries` 基础上追加。交互模式下等待期间监听终端输入，`Esc`/`Ctrl+C` 结束等待（pi 自己的中断此时在等这个处理器返回）；无界面模式有总时长上限。

## 8. 写保护与命令审批

- `materials/`（或 2PI.md 的"材料目录"）与 `.2pi/`（`scratch/` 除外）直接拒绝写入。
- 知识库、agent 自身、论文原件、工作目录外的路径需要确认。
- 已有文件如果不在稿件区域内，可能是作者原稿，修改需要确认。稿件区域 = 2pi 项目的 `notes/`、各领域包声明的区域（paper 的 LaTeX 项目、中文说明、账本；patent 的 `patent/`、patent JSON、事实清单）、本会话新建的文件、以及此前各轮修改记录中 agent 改过的文件。没有项目卡时不把 `paper/`、`notes/` 默认当作稿件区域（research2paper 在真实项目里见过 `paper/` 放的是相关论文）。
- 命令：上传文件、改写/推送 git 历史、工作目录外的递归删除、修改 `materials/`、下载即执行、卸载软件包需确认。
- 需要确认的操作在无界面模式下一律拒绝；`--full-access` 关闭全部限制。

## 9. 从 codex 借鉴的

| codex | 2pi |
|---|---|
| `update_plan` | `update_plan` |
| `request_user_input` | `ask_user` |
| sandbox workspace-write + on-request 审批 | guard |
| AGENTS.md | 项目卡 2PI.md + 项目内 AGENTS.md |
| `codex exec` | `2pi -p` / `--mode json` |
| 模型 provider 配置 | `2pi import-codex` 按 pi 原生格式写入 codex 的 provider、模型目录与取密钥命令 |
| `stream_max_retries`、"Reconnecting... waiting for network" | pi 的 `retry` 默认 5 次；断网时探测网络、恢复后续跑（`core/reconnect.ts`） |
