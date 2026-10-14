# 2pi 方案：材料 → 论文 → 专利 的垂直 agent

把 p2p（论文 → 专利申请初稿）和 research2paper（材料 → SCI 论文初稿）合成一个 agent：**2pi**。两者都是 pi 扩展、同一套底座思路（替换系统提示词 + 领域工具 + 写保护 + 收尾关卡 + skill 作为规则来源），所以融合的正确方式是**一个共享内核 + 两个领域包**，而不是把两份 index.ts 拼在一起。

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 1. 名字 | 用 **2pi**（命令 `2pi`）。理由与约束见 §1 |
| 2. 系统提示词 | **要替换**，p2p 已经替换了 pi 的 coding 前言；2pi 需要的是**分层提示词**：共享的写作宪法 + 工作方式 + 工具 + 项目卡 + 当前领域 skill + 动态项目状态（§3） |
| 3. 调研工具 | **要加，但排在内核和改动可视化之后**：文献检索（OpenAlex/arXiv/Crossref）、专利检索（EPO OPS/PatentsView + 人工检索式）。前提是只引用真正取回的来源、联网检索需项目授权（§4） |
| 4. 像 Cursor 一样看清改动 | **需要一个专门的"展示格式"**，但它不是先做 GUI，而是三层地基：可 diff 的源格式 + 每轮检查点（shadow git）+ 块级变更集（Change Set）。有了它，TUI、HTML 审阅页、Word 修订模式、latexdiff PDF、VS Code 扩展都只是不同的渲染器（§5） |
| 5. 分阶段 | P0 地基 → P1 最小闭环（材料→论文→专利）→ P2 改动可视化 → P3 调研 → P4 编辑器级 UI → P5 评测（§6） |

## 1. 命名

- 推荐 **2pi**：读作 two-pi，暗示"基于 pi"，也是 2π 的闭环（材料 → 论文 → 专利）；`2p` 太短，难搜索，也容易和别的东西撞名。
- 约定：命令 `2pi`；npm 包名 `2pi-agent`；用户配置目录 `~/.2pi`；项目卡 `2PI.md`；项目状态目录 `.2pi/`。
- **环境变量不能以数字开头**（`2PI_HOME` 在 POSIX shell 中非法），前缀用 `TWOPI_`；TypeScript 标识符同理用 `twoPi`。
- 不保留 `p2p` 别名（目前只有你在用），`import-codex` 等子命令原样保留。

## 2. 目标架构

```
2pi launcher（pi main() + 独立配置目录）
└── core（与领域无关，地基）
    ├── 提示词内核：写作宪法、工作方式、工具渲染、<project_state>
    ├── 项目：2PI.md 项目卡、类型识别（paper / patent / both）、统一目录布局
    ├── 守卫：工作区写入沙箱、materials/ 与知识库只读、高危命令审批
    ├── 关卡框架：各领域注册"交付前检查"，共享防死循环预算
    ├── 检查点：每轮结束提交 shadow git；/undo、/checkpoints
    ├── 变更集：每轮的块级改动记录（§5），供所有 UI 渲染
    ├── 通用工具：update_plan、ask_user、pdf_preview、paper_ingest、evidence、compute_stats
    └── Python/外部程序运行器
├── pack: paper（移植 research2paper）
│   skill research2paper；check_draft、latex_compile、paper_init、fill_gaps、bib_lookup
└── pack: patent（现有 p2p）
    skill paper2patent；patent_check、patent_build
```

**融合点而非拼接点：**

- **共享证据账本** `notes/evidence.json`：论文写作时记录的每条事实和数字（含出处、四类证据分类）就是专利的"源事实清单"。专利的 `support_map` 直接引用账本条目，忠实性可追到材料原件，比从 PDF 反解析更可靠。
- **论文项目直接转专利**：patent pack 优先读同一项目里的 LaTeX 源、账本和 materials，没有时才走 PDF 解析。
- **一套守卫、一套关卡、一套检查点**：两个领域的"改完必须检查、渲染后必须看"都走同一个框架。

**统一项目布局（由 `2pi init` 生成，已有文件不覆盖）：**

```
project/
  2PI.md                   项目卡：类型、目标期刊/专利模式、语言、联网检索许可
  materials/               作者原始材料（只读）
  paper/                   main.tex、sections/*.tex、refs.bib、figures/、build/
  patent/                  patent.json、out/（附图、DOCX、PDF、preview/）
  notes/                   memo.md（中文说明）、evidence.json（证据账本）、fact_sheet.md
  research/                文献卡片、相关工作对比矩阵、专利检索式与对比文件表
  .2pi/                    状态、检查报告、变更集、shadow git 检查点
```

兼容旧布局：识别 `PAPER.md`（research2paper）和根目录 `patent.json`（p2p）。

**skill 的位置：** 两个 skill 仍在各自仓库维护。2pi 用 `npm run sync-skills` 把它们复制到 `agent/skills/` 并记录来源提交号，用于打包；开发时可用 `TWOPI_SKILLS_DIR` 指向源仓库。

## 3. 系统提示词：分层替换

pi 的 coding 前言（"expert coding assistant"、pi 文档段、编码规则）对 2pi 全是噪声，必须替换；pi 的机制层（工具 schema、skills 列表格式、项目上下文、压缩）保留。注意：设置 `customPrompt` 后 pi 会去掉自带的 tools/rules 段，所以内核要自己渲染工具清单和各工具的 guidelines（research2paper 的 `buildPreamble` 已经这样做，直接复用）。

| 层 | 内容 | 变化频率 |
|---|---|---|
| L0 身份与宪法 | 2pi 是谁；跨领域不可违背规则：忠实性高于完整性、缺口用标记（`[MISSING: …]` / `【待补充：…】`）不猜、交付物与说明两层分离、不给录用概率或授权前景、只引用真正读过的来源 | 固定 |
| L1 工作方式 | 自主规划（update_plan）、先读完全部材料、中间成果落文件、改完先自检、渲染后亲眼看、环境问题先自救 | 固定 |
| L2 工具 | 由当前激活工具渲染，含各工具 guidelines | 很少变 |
| L3 项目卡 | `2PI.md`（作为 project_context 注入） | 按项目 |
| L4 领域 skill | 当前项目类型对应的 SKILL.md 正文内联；另一个领域只列名称、描述和路径，按需读取 | 按项目 |
| L5 `<project_state>` | 最近一次检查/编译结果、改过但未检查的文件、账本概况、本轮之前的变更集摘要 | 每轮 |

静态层在前、动态层在最后，保证提示词缓存命中。项目类型未知（空目录、只有一句需求）时，L4 两个 skill 都只列摘要，由模型判断后读取。

## 4. 工具

| 工具 | 来源 | 阶段 |
|---|---|---|
| update_plan、ask_user | p2p | P0（移入 core） |
| paper_ingest | p2p | P0（移入 core，论文与专利都用） |
| patent_check、patent_build | p2p | P0（patent pack） |
| check_draft、latex_compile、paper_init、fill_gaps | research2paper | P1 |
| evidence、compute_stats | research2paper | P1（移入 core，共享账本） |
| bib_lookup、pdf_preview | research2paper | P1 |
| checkpoint / undo / changes | 新 | P0 内核，P2 增强 |
| **lit_search** | 新 | P3：OpenAlex + arXiv + Crossref（免密钥）；可选 Semantic Scholar key。返回题目、作者、年份、venue、DOI、摘要、被引数 |
| **lit_fetch** | 新 | P3：下载开放获取 PDF 到 `materials/refs/`，再用 paper_ingest 读全文；条目进账本并标注来源 |
| **patent_search** | 新 | P3：EPO OPS（免费，需申请 key，含 CN 文献著录与摘要）、PatentsView（美国，需 key）；同时生成可人工执行的检索式（Google Patents / CNIPA），产出对比文件候选表 |
| idea 调研报告 | 新（工作流由模型自主，模板在 skill） | P3：相关工作按机制轴的对比矩阵 + 研究空白论证 + 每条引用经 bib_lookup 核验 |

**调研工具的两条红线：**

- 只引用真正取回并读过的来源；检索结果也进证据账本。专利检索结果只是"对比文件候选"，不构成新颖性意见。
- **未公开的 idea 不应随便发给第三方检索服务**：联网检索默认关闭，需在 `2PI.md` 写明 `Online search: allowed`；每次检索的查询词显示在界面并记入日志。

## 5. 改动可视化：先定展示格式，再做界面

"哪些改了、哪些没改一眼看出来"的关键不在界面，而在三层数据。

### 5.1 可 diff 的源格式

- **论文：** LaTeX 分节文件，约定一句一行（或一段一行），git diff 和 latexdiff 都能精确到句。
- **专利：** patent.json 仍是唯一事实来源（脚本契约不动），但要求稳定的字段顺序与缩进；内核提供"块模型"把它展开成可读的块：`abstract`、`claims/1..n`、`description/<节>/<段>`、`drawings/<n>`。

### 5.2 检查点（shadow git）

- 每轮 `agent_settled` 时提交一次，存放在 `.2pi/history`（独立的 GIT_DIR，工作树是项目目录），**不碰用户自己的 git 仓库**。
- 提交说明 = 用户这轮的请求。
- `/undo` 回到上一轮，`/checkpoints` 列出历史，任意两轮之间可以 diff。

### 5.3 变更集（Change Set）：所有 UI 的共同输入

```json
{
  "id": "c0007",
  "checkpoint": "a1b2c3d",
  "prompt": "把权利要求1里的视觉语言模型概括一下",
  "summary": "概括权利要求1中的模型限定，说明书相应补充替代实现",
  "changes": [
    { "doc": "patent", "block": "claims/1", "op": "modified", "before": "…", "after": "…", "why": "去掉具体模型类型，扩大保护范围" },
    { "doc": "patent", "block": "description/embodiments/12", "op": "added", "after": "…" },
    { "doc": "paper", "block": "sections/methods.tex#L41", "op": "modified" }
  ],
  "checks": { "patent_check": { "errors": 0, "warnings": 1 }, "latex_compile": "ok" }
}
```

块的对齐用内容序列比对（LCS），不依赖会漂移的段落编号。`why` 由模型在收尾时填写（一个轻量的 `report_changes` 工具，或从最终答复中抽取）。

### 5.4 渲染器（按投入从小到大）

| 渲染器 | 给谁看 | 阶段 |
|---|---|---|
| TUI 挂件：每轮结束显示"本轮修改：权利要求1、3；说明书[0021]–[0024]；图2" + `/changes` 逐块彩色字级 diff | 你 | P2 |
| HTML 审阅页 `.2pi/review/<编号>/review.html`：整篇文档，改动处红删绿增并标出原因，未改动部分折叠；`/redline` 生成并用浏览器打开（`/review` 已是专利审查命令） | 你、合作者 | P2 |
| **论文：latexdiff 修订 PDF**（TeX Live 自带，本机已有） | 合作者、审稿回复 | P2 |
| **专利：Word 修订模式 DOCX**（w:ins/w:del），代理师最熟悉的审阅方式 | 专利代理师 | P2 |
| **VS Code / Cursor 扩展**：聊天面板经 `2pi --mode rpc` 驱动；原生 diff 编辑器对比检查点；逐块"接受/拒绝"（拒绝 = 从上一检查点恢复该块）；PDF 与附图预览面板 | 日常主界面 | P4 |

**为什么 GUI 选 VS Code/Cursor 扩展而不是自建网页：** Cursor 本身就是 VS Code，文件树、diff 编辑器、LaTeX 与 Markdown 编辑、git 都是现成的；pi 的 RPC 模式是有文档的稳定接口，扩展 UI 协议也已支持对话框。自建 Web 应用只在需要给不用编辑器的人用时才值得做，放到 P4 之后再评估。

## 6. 分阶段计划

每个阶段都以"真实模型跑通一个案例 + 离线测试全绿"收尾，下一阶段只在上一阶段的地基上加东西。

### P0 地基（规模：中）— ✅ 已完成

**验收（同一篇论文、同一模型 gpt-6.1-sol xhigh、同一请求，direct 模式）：**

| | p2p | 2pi P0 |
|---|---|---|
| 用时 | 约 29 分钟 | 约 22 分钟 |
| 未缓存输入 / 输出 token | 23.7 万 / 3.4 万 | 20.7 万 / 3.5 万 |
| 缓存读取 token | 332 万 | 263 万 |
| 最终检查 | 0 ERROR / 0 WARN | 0 ERROR / 0 WARN |
| 申请文件 PDF | 模型自己写脚本调用 Word | `patent_build` 自动用 Word 导出（可检索） |
| 重复读仓库 SKILL.md | 是（上级目录的 CLAUDE.md 被注入） | 否（上级目录的说明被过滤） |
| 修改记录 | 无 | c0001，记录 20 个文件，可 `/undo` |

验收中发现、并已在 P0 内修正：模型自己写脚本导出撰写说明 PDF（现由 `patent_build` 一并导出两份 PDF 和预览页），以及把临时核对文件放进交付目录（现提供 `.2pi/scratch/`，并在提示词中说明）。

计划项：

1. 改名 2pi：包名、命令、`~/.2pi`、`TWOPI_*`、`2PI.md`、`.2pi/`；`import-codex` 保留。
2. 拆成 core + pack 结构：定义 Pack 接口 `{ id, title, skill, detect(cwd), register(), guide(), stateLines(), pendingWork() }`；现有 p2p 代码迁入 `packs/patent`。
3. 提示词内核分层（§3 的 L0–L2、L5），patent pack 提供 L4。
4. 项目卡 `2PI.md` 与 `2pi init`；识别旧布局。
5. 检查点：shadow git、`/undo`、`/checkpoints`。
6. 变更集记录到 `.2pi/changes/`，先只做文件级（改了哪些文件、增删行数），TUI 显示一行摘要。
7. 修 p2p 已知问题：没有 LibreOffice 时 patent_build 自动改用 Word 导出可检索 PDF；在仓库内运行时不重复读 SKILL.md。

**完成标准：** 离线测试全绿；用 2pi 重跑 NingBGM，结果不差于 p2p 那次；`/undo` 能撤回一轮修改。

### P1 最小闭环：材料 → 论文 → 专利（规模：大）— ✅ 已完成

讨论后拆成两块，并确定账本的定位：论文侧必须用，专利侧有账本就用、只有 PDF 时照旧用事实清单；paper2patent skill 不依赖账本。

**P1a 论文包：**
1. 移植 research2paper 到 `packs/paper`：config、checker、latex、bib、gate、工具五个（paper_init、check_draft、latex_compile、fill_gaps、bib_lookup）、`/paper` 命令；skill 与 LaTeX 模板由 `npm run sync-skills` 同步进 `agent/skills/`、`agent/templates/paper/`。依赖对齐到 pi 1.1.0。
2. evidence、compute_stats、pdf_preview 进 core；账本位置由 2PI.md"证据账本"决定，默认 `notes/evidence.json`。
3. 关卡升级：领域包 `autoCheck`（harness 自己编译与检查本轮改动）+ `pendingWork`（只有模型能做的核对），共用每次请求两轮的修复预算；专利改完 JSON 也改为自动检查。
4. 写保护合并 research2paper 的规则：已有作者文件不在稿件区域内时需确认，修改 materials/ 的命令需确认。
5. 移植测试：账本、统计、LaTeX 日志、Crossref（模拟）、写保护、检查目标，以及会话级的检查、修复轮、fill_gaps、V01、三套模板真实编译、pdf_preview。

**P1b 论文 → 专利：**
1. patent 的工作指引：同项目有论文源与账本时以它们为源，不从 PDF 反解析，不再写 fact_sheet.md；新事实先记账；support_map 写成"E12 / 论文§3.1"。
2. 专利数字对账（`packs/patent/ledger.ts`）：沿用 V01 的判定（按书写精度匹配、missing 条目不算），适配中文专利文本（跳过附图标记、步骤号、年份、【待补充】）；patent_check 与自动检查都输出，只提示不阻断。
3. 修复验收中发现的问题：用 pdf_preview 看过的 PDF 计为已查看。

**验收（虚构 SWD 案例，gpt-6.1-sol xhigh）：**

| 轮次 | 结果 | 用时 | 未缓存输入 / 输出 token |
|---|---|---|---|
| P1a 写 Methods 与 Results 两节 | 编译 4 页；检查 0 ERROR / 0 WARN（含账本对账，0 个 V01）；账本 17 条 | 约 8 分钟 | 7.6 万 / 1.3 万 |
| P1b-1 补入自适应窗口材料 | 编译 5 页；0 / 0；账本更新到 33 条（新增与修改并用） | 约 10 分钟 | 8.5 万 / 1.4 万 |
| P1b-2 论文转专利 | 6 项权利要求、4 张附图、14 处【待补充】；0 ERROR、4 WARN（均为"中位绝对偏差"被当成绝对化措辞的误报，已在说明中写明）；申请文本数值全部能在账本找到；6 项权利要求的 support_map 全部引用账本条目；没有另写事实清单；Word 导出可检索 PDF | 约 23 分钟 | 25.3 万 / 2.5 万 |

**对照：同一篇论文直接从编译后的 PDF 转专利（新目录，无账本）**

| | 账本路线（P1b-2） | PDF 路线（对照） |
|---|---|---|
| 用时 | 23 分钟 | 13 分钟 |
| 未缓存输入 / 输出 token | 25.3 万 / 2.5 万 | 11.4 万 / 2.0 万 |
| 工具调用 | 81 次（read 48、pdf_preview 6、evidence 2、构建 2） | 61 次（read 42、构建 1） |
| 检查 | 0 ERROR、4 WARN（同一误报） | 0 ERROR、4 WARN（同一误报） |
| 权利要求 1 | 以峰值/MAD 触发二分为核心（较窄） | 以逐窗 MAD 估计噪声底为核心，二分规则放在从属权利要求（较宽） |
| 追溯 | 数值全部对上账本；support_map 全部引用条目编号 | 写了自由文本的 fact_sheet.md |

解读（各只跑了一次，只能看方向）：账本路线多出的开销主要来自审阅方式而不是记账——它用 pdf_preview 以 1400 像素宽把两份 PDF 整本渲染了两遍，又多构建了一次；evidence 只调用了 2 次。已在专利工作指引中改为"看版面用构建生成的预览页，pdf_preview 只用于个别页细节"。权利要求范围的差异不能归因于账本，需要在 P5 用多次运行和盲评判断。

**完成标准：** 合成案例用真实模型一次跑通：论文 PDF 编译成功、checker 0 ERROR；专利 DOCX/PDF 0 ERROR；专利中每个权利要求特征都能追到账本条目。——已达到。

### P2 改动可视化（规模：中）— ✅ 已完成

块模型（论文按句/段，专利按字段）、块级变更集、`report_changes`、TUI `/changes`、HTML 审阅页、latexdiff 修订 PDF、Word 修订模式 DOCX。

**完成标准：** 让 agent 改一轮权利要求和一段方法，三种视图都能准确标出改了哪些块、为什么改，没改的部分不标。——已达到。

**实现：**
1. 块模型（`core/blocks.ts`）：专利 JSON 按申请文件结构切块（发明名称、摘要、每项权利要求、说明书每段、每张附图、撰写说明各项），LaTeX 按段落（标题取所在的节），证据账本按条目，Markdown/纯文本按段；其他文件（生成的 SVG、数据、代码）只列出，不逐块比较。
2. 对齐与差异（`core/blockdiff.ts`）：块序列 LCS 对齐，插入一项权利要求只标它自己；块内中文逐字、英文按词，再做语义合并，改写读起来是成片的短语。
3. 变更集增加 `blocks`、`summary`、`notes`；`report_changes` 可多次调用，原因按"块 > 节 > 文件"挂接，越具体越优先；修订已有稿件却没说明时，交付前检查提醒一次（新稿件和只刷新生成字段的构建不提醒）。
4. 视图：每轮结束的挂件 + `/changes` 可滚动逐块视图；`/redline`（和 `redline` 工具）在 `.2pi/review/<编号>/` 生成 `review.html`、专利 `*-redline.docx`（Word 修订 + 批注）、论文 `paper-redline.pdf`（latexdiff，从检查点还原两版到临时目录编译）。
5. 测试：新增 12 个（块切分、插入不连带、中英文差异与语义合并、原因匹配的三级优先、端到端 report_changes → 变更集 → 查看器 → 审阅页 → DOCX、门控提醒、latexdiff、生成文件不切块）；离线共 56 个全部通过。

**验收（虚构 SWD 案例，gpt-6.1-sol xhigh，在 P1 的项目上继续修改）：**

| | 第 1 轮 c0004 | 第 2 轮 c0005 |
|---|---|---|
| 请求 | 权利要求1"最大绝对样本值"改称"峰值"并统一说明书；精简 Methods 中 SWD-A 一段 | 权利要求4"拆窗决策模块"改名并统一说明书；压缩 Results 中 SWD-A 与 SWD 比较的一段 |
| 用时 / 未缓存输入 / 输出 | 约 8 分钟 / 18.3 万 / 1.0 万 | 约 10 分钟 / 18.5 万 / 1.2 万 |
| 专利块 | 87 块中 11 块标为修改（摘要、权利要求1与4、说明书5段、撰写说明3项），其余 76 块没有一处旧术语 | 87 块中 7 块（权利要求4、说明书3段、图3、撰写说明2项），全文无旧名称 |
| 论文块 | methods.tex 8 段中 1 段 | results.tex 8 段中 1 段 |
| 终端 `/changes` | 逐块列出 17 处，字级增删标记与原因；未改动的权利要求不出现 | 同左，12 处 |
| HTML 审阅页 | 17 个改动块带原因，未改动段落折叠；375 px 宽无横向滚动 | 同左 |
| Word 修订 DOCX（Word 2021 打开核对） | 93 段中 33 条修订全部落在这 11 段内，11 条批注即原因，修订模式开启；权利要求2、3、5、6 等无标记 | 23 条修订全部落在 7 段内，7 条批注 |
| latexdiff PDF | 5 页，只有 SWD-A 段落带删改标记 | 同样只标被压缩的一段 |
| 原因 | 模型按文件写原因，同一句挂在该文件全部块上 | 模型先按文件和节写，再按块名补充，专利 7 块各有自己的原因 |

**验收中发现并已修正：**
- 英文改写的词级差异过碎（`[-was-]{+aimed+} [-designed -]to …`）→ 语义合并后为 `[-was designed to reduce-]{+aimed to limit+}`。
- 文件级原因覆盖所有块 → 改为"块 > 节 > 文件"，工具说明引导按块写、不为生成文件写原因；没对上块的备注超过两条时在审阅页折叠。
- 第二次调用 `report_changes` 时必填的 summary 被写成"补充理由"，覆盖了真正的总结 → summary 改为可省略，保留之前的总结。
- 按节写的目标（"说明书·发明内容"）对不上 → 增加节前缀匹配（不会把"权利要求1"匹配到"权利要求10"）。
- 生成的 SVG 被按段落切块 → 只对领域格式、账本和散文类文本逐块比较。

以上修正发生在两轮运行之后：c0004、c0005 记录中保存的原因是当时的匹配结果，视图（差异合并、SVG 不切块、备注折叠）是用修正后的代码重新生成的。

### P3 调研（规模：中）— ✅ 已完成（专利数据库检索待配置账号后验收）

lit_search、lit_fetch、patent_search、联网授权开关、检索日志、idea 调研报告模板（写进 skill 的 references）。

**完成标准：** 给一个 idea，产出相关工作对比矩阵，所有引用经 bib_lookup 核验为真；给一份专利草稿，产出检索式和对比文件候选表，并写进撰写说明。——已达到；专利候选需要专利数据库（见下）。

**实现：**
1. 联网层 `core/online.ts`：项目卡"联网检索：允许"或终端里本会话确认一次；请求重试与 Retry-After；检索日志 `.2pi/research/searches.jsonl`。项目卡未允许时，bash 里的 curl / wget / Invoke-WebRequest / `python -c` HTTP 调用需要确认（无界面时拒绝）；允许时这些命令也记入日志。
2. 辅助领域包 research（`auxiliary`，服务论文与专利）：`lit_search`（OpenAlex 题名与摘要、arXiv、Crossref 兜底；`citing` / `references_of` 滚雪球）、`lit_fetch`（按编号核实、完整摘要、仅由元数据生成的 BibTeX、下载开放获取 PDF，拿不到时再试出版社页面声明的 `citation_pdf_url`）、`patent_search`（EPO OPS；未配置时不联网、只给 Google Patents / Espacenet 链接）、`patent_import`（Google Patents / Espacenet / 国知局 CSV）、`/research`。
3. 调研库 `.2pi/research/library.json` + 引用核验：本轮写入文件中的 DOI、arXiv 编号、专利公开号必须在调研库、作者材料或已解析论文中，否则交付前检查启动修复轮；同一行写明"待核实"的视为已声明。bib_lookup 在 Crossref 确认的 DOI 也入库。
4. 2pi 自有的 `agent/skills/research`：原则（只引用检索到的、不下新颖性结论、未申请的发明用公知术语检索、先读再判断）、检索策略与各库语法、idea 调研报告模板（检索记录 + 逐特征 ●/◐/○ 矩阵）、现有技术检索与对比文件候选表（X/Y/A，写进 `notes["检索与对比文件"]`）。
5. 测试 13 个（编号抽取与声明、核验集合、OpenAlex/arXiv/Crossref/OPS/CSV 解析、未授权不发请求、日志与入库、引用核验修复轮、OpenAlex 失败转 Crossref、未配置专利服务只给链接、导入与 OPS 结果用于核验、bib_lookup 入库、联网命令识别、citation_pdf_url），另加 print 模式回归测试；离线共 68 个全部通过。

**验收（gpt-6.1-sol xhigh）：**

| | idea 调研（新项目，虚构的峰值/MAD 触发拆窗想法） | 专利现有技术检索（SWD 案例的专利草稿） |
|---|---|---|
| 用时 / 未缓存输入 / 输出 | 约 42 分钟 / 35.5 万 / 5.5 万 | 约 30 分钟 / 30.6 万 / 3.2 万 |
| 检索 | 27 次检索、37 次获取（OpenAlex、arXiv），读了 5 篇全文；调研库 207 条 | 11 次文献检索（OpenAlex、arXiv、Crossref）、14 次获取；3 次专利检索（未配置服务，只生成链接） |
| 产出 | `research/idea-survey.md`：检索记录、F1–F5 对比矩阵、分组综述、对三个问题的回答（"在已读范围内未见该组合"，不下首创结论）、18 篇参考文献，逐篇注明全文/仅摘要 | 撰写说明新增"检索与对比文件"：检索日期与范围、11 条检索记录（含命中/保留数）、3 组英文专利检索式及链接、中文补检式、分类号线索、8 篇候选（书目表 + 技术比较表，Y/A，注明阅读层级）；DOCX/PDF 已重新生成，表格正常排版 |
| 独立核验 | 报告中 20 个编号（19 个 DOI、1 个 arXiv）全部在 DOI 注册系统 / arXiv 中存在；18 条参考文献的题名与检索到的记录逐条一致 | 9 个编号（7 个 DOI、2 个 arXiv）全部存在 |
| 引用核验关卡 | 未触发（所有编号都来自检索） | 未触发 |

**验收中发现并已修正：**
- 论文包把 `research/*.md` 当成论文章节检查，报了 25 条英文论文写作 WARN（缩写未定义等），模型花了一轮去"修"——研究报告现在不归论文检查器管。
- 拿不到开放获取 PDF 时，模型自己写 Python 脚本抓出版社网页（绕过检索日志）——`lit_fetch` 增加 `citation_pdf_url` 回退并要求拿不到就依据摘要；允许联网时命令行联网也记入日志。
- 交付前检查在不启动修复轮时把报告追加在最终答复之后，`2pi -p` 因此输出为空（pi 的 print 模式只输出最后一条助手消息）——print 模式下不再追加这类报告。

**未完成：** 专利数据库检索。EPO OPS 的客户端与解析只用合成数据测试过，需要一个 OPS 账号（免费注册）做真实验收；不配置时的"链接 + 用户导出 CSV + patent_import"路径已可用。两次运行的开销都偏高（单次 30–40 分钟），主要花在逐篇获取与阅读全文上，P5 再评估是否需要限制。

### P4 编辑器级 UI（规模：大）

VS Code/Cursor 扩展：RPC 聊天面板、变更集侧栏、原生 diff 对比检查点、逐块接受/拒绝、PDF/附图预览。

**完成标准：** 在 Cursor 中完成一次"提需求 → 看改动 → 拒绝其中一块 → agent 继续"的完整回合。

### P5 质量（持续）

沿用两个仓库的 `evals/`：同一批案例分别用"只有 skill 的 pi"和 2pi 跑，盲评对比；统计交付时剩余 ERROR、编译成功率、token 成本。

## 7. 刻意不做（现阶段）

- 不 fork pi；不把写作规则写进 agent 代码（规则只在 skill）。
- 不做多 agent 流水线（等单 agent 闭环稳定、有评测数据再说；P5 后可考虑独立的"审稿员/审查员"复核 agent）。
- 不先做 GUI：变更集格式不稳定时做的界面都会返工。
- 不自动补引用、不给新颖性结论、不给录用或授权概率。

## 8. 风险

| 风险 | 对策 |
|---|---|
| pi 版本漂移（research2paper 基于 1.0.4，p2p 基于 1.1.0） | 依赖精确锁版本；升级前跑完整离线测试 |
| 两套规则冲突（论文用英文 `[MISSING]`，专利用中文【待补充】） | 宪法层只定义原则，标记格式由各自 skill 决定 |
| 联网检索泄露未公开 idea | 默认关闭，项目卡显式授权，查询词可见可审计 |
| shadow git 与用户仓库互相干扰 | 独立 GIT_DIR 放在 `.2pi/`，并把 `.2pi/` 写入项目 `.gitignore` |
| `agent/` 目前被 `.gitignore` 忽略 | 地基需要版本管理：建议取消忽略，或迁到独立的 2pi 仓库 |
