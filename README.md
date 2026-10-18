<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" width="420" alt="2pi 的标识：一本摊开的书，左页的 2 一笔连到右页的 π">
  </picture>
</p>

<h1 align="center">2pi</h1>

<p align="center">
  <b>材料 → 论文 → 专利</b>，一个开源的科研写作 agent<br>
  把实验材料写成可逐句核对的 SCI 论文初稿，再把论文写成中国发明专利申请初稿
</p>

<p align="center">
  <i>An open-source research-writing agent built on pi: research material → paper draft → Chinese invention patent draft.</i>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@7tocr/2pi"><img src="https://img.shields.io/npm/v/@7tocr/2pi?color=4c769f&label=npm" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4c769f" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022.19-4c769f" alt="Node.js ≥ 22.19">
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/built%20on-pi%201.1.0-4c769f" alt="built on pi"></a>
  <a href="#参与贡献"><img src="https://img.shields.io/badge/PRs-welcome-5bc4d8" alt="PRs welcome"></a>
</p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#登录模型">登录模型</a> ·
  <a href="#五分钟上手">五分钟上手</a> ·
  <a href="#常用命令">常用命令</a> ·
  <a href="#参与贡献">参与贡献</a> ·
  <a href="DESIGN.md">设计文档</a>
</p>

---

## 2pi 是什么

写论文、把论文转成专利，有大量既重复又要求严谨的工作：从实验记录里找出每个数字并核对出处，按期刊要求组织章节和排版，核实每一条参考文献；转专利时还要把论文改写成权利要求书和说明书，并逐项符合形式要求。

2pi 把这些工作交给一个 agent，同时让每一步都**可核对、可撤回**：

- **一个项目，两种产出。** 同一个目录里先写论文、再转专利；写论文时记下的事实和数字，转专利时直接作为源事实。
- **每个数字都有出处。** 证据账本（`notes/evidence.json`）记下每条事实、数字和来源；比率、差值、百分点用工具精确计算，不靠模型心算。
- **交付前自己检查。** 每轮结束前自动编译 LaTeX、运行论文检查器或专利形式检查，有错误先自己修，修不好就如实说明。
- **改了什么一目了然。** 按段落、按每一项权利要求记录修改和原因，可以看 HTML 审阅页、Word 修订模式 DOCX 或 latexdiff PDF，`/undo` 一步撤回。
- **不编造文献。** 只引用真正检索到的文献；稿件里出现查不到来源的 DOI、arXiv 编号或专利号，会被拦下来核实。
- **材料只读，联网要授权。** `materials/` 里的原始材料 agent 只能读；只有你同意，才会把检索词发给外部服务，论文内容不会外传。
- **用你自己的模型。** Claude、ChatGPT、Gemini、DeepSeek、Kimi、智谱 GLM、通义千问，以及任何兼容 OpenAI / Anthropic / Google 接口的服务。

2pi 基于 [pi](https://pi.dev) 二次开发，由一个共享内核和若干领域包组成，每个领域以对应的 skill 为知识库：

| 领域包 | 能力 | 知识库 |
|---|---|---|
| paper | 研究材料 → 可逐句核对的 SCI 论文初稿（LaTeX/PDF + 中文说明） | `skills/research2paper` |
| patent | 论文 → 中国发明专利申请初稿（说明书摘要、摘要附图、权利要求书、说明书、说明书附图，DOCX/PDF + 撰写说明） | `skills/paper2patent` |
| research（辅助） | 文献与 idea 调研、专利现有技术检索：检索记录、逐特征对比矩阵、检索式与对比文件候选 | `skills/research` |

做什么、按什么顺序、何时回头修改，由模型根据材料和你的要求自己决定；2pi 提供领域知识、专用工具、安全边界、检查点和交付前检查。

> [!NOTE]
> 2pi 的产出是供作者、专利代理师复核的**初稿**，不是法律意见，也不评估录用或授权前景。

### 欢迎成为贡献者

2pi 刚刚开源，还有很多事可以一起做。无论你是科研人员、专利代理师，还是对 agent 开发感兴趣的工程师，都欢迎提 issue、完善写作规则、补充期刊模板或贡献代码。不写代码也能帮忙：一份清楚的问题报告、一次真实的使用反馈，同样能让 2pi 变得更好。请从[参与贡献](#参与贡献)开始。

## 安装

### 环境要求

| 依赖 | 用途 | |
|---|---|---|
| [Node.js](https://nodejs.org/) ≥ 22.19 | 运行 2pi | 必需 |
| Python ≥ 3.9，以及 Pillow、PyMuPDF | 解析 PDF 材料、运行检查脚本、生成专利附图 | 必需 |
| git | 每轮的检查点与 `/undo` | 建议 |
| [tectonic](https://tectonic-typesetting.github.io/)（推荐），或 TeX Live / MiKTeX 自带的 latexmk | 编译论文 PDF | 写论文时需要 |
| LibreOffice；Windows 上也可以用 Microsoft Word | 把专利 DOCX 导出为 PDF | 可选 |

没有 LibreOffice 和 Word 时，专利申请文件改为生成图像版的审阅 PDF，DOCX 不受影响。

### 用 npm 安装（推荐）

```bash
npm install -g @7tocr/2pi
python -m pip install "Pillow>=9" "pymupdf>=1.24"
2pi --version
```

pi 已经包含在内，不需要另外安装。npm 不会安装 Python 依赖，所以要单独执行第二行。看到 `2pi 0.0.1 (pi 1.1.0)` 这样的输出就说明装好了。

也可以用 `pnpm add -g @7tocr/2pi` 或 `bun add -g @7tocr/2pi` 安装。

> [!TIP]
> Windows PowerShell 如果提示"禁止运行脚本"（`npm.ps1` 或 `2pi.ps1`），把命令中的 `npm` 换成 `npm.cmd`、`2pi` 换成 `2pi.cmd`。

### 从源码安装

```bash
git clone https://github.com/7toCR/2pi.git
cd 2pi
npm ci --ignore-scripts
python -m pip install -r python/requirements.txt
npm link
2pi --version
```

源码安装直接运行 `src/` 下的 TypeScript，不需要编译。不想 `npm link` 时，用 `node bin/2pi.mjs` 代替 `2pi`。

### 升级

- npm 安装：`npm install -g @7tocr/2pi@latest`
- 源码安装：在仓库目录执行 `git pull`，再执行 `npm install`

`2pi update` 不会升级 2pi 自己，只会提示上面的命令；`2pi update --models` 更新模型目录。

## 登录模型

2pi 不自带模型，第一次使用前要接入一个模型服务。登录方式、第三方 API 和模型配置文件**都与 pi 相同**，只是配置目录换成了 `~/.2pi/agent`（Windows 下是 `%USERPROFILE%\.2pi\agent`），和 pi 互不干扰。

### 方式一：`/login`（推荐）

启动 `2pi`，在底部输入框中输入：

```text
/login
```

先选择登录方式：**Sign in with an account** 用订阅账号在浏览器里授权，**Sign in with an API key** 粘贴 API Key。然后选择服务商。知道服务商名字时可以直接写在后面：

| 输入 | 效果 |
|---|---|
| `/login anthropic` | Claude：选择用 Claude Pro/Max 账号登录，或填 Anthropic API Key |
| `/login openai` | OpenAI：选择用 ChatGPT 订阅账号登录，或填 OpenAI API Key |
| `/login github-copilot` | 用 GitHub Copilot 订阅登录 |
| `/login deepseek` | 直接提示输入 DeepSeek API Key |
| `/login moonshotai-cn` | 直接提示输入 Moonshot（Kimi）API Key |

凭据保存在 `~/.2pi/agent/auth.json`。登录之后：

| 输入 | 作用 |
|---|---|
| `/model` | 选择模型：输入关键字过滤，回车选用，`ctrl+s` 设为以后的默认模型 |
| `/thinking` | 选择思考强度，`ctrl+s` 保存为默认 |
| `/logout` | 删除 `/login` 保存的凭据 |

`/model` 只列出已经登录的服务商的模型。

### 方式二：环境变量

不想把 Key 存进文件（例如在服务器或 CI 上）时，设置服务商的环境变量即可。变量名与 pi 相同：

| 服务商 | `/login` 名称 | 订阅账号登录 | API Key 环境变量 |
|---|---|---|---|
| Anthropic（Claude） | `anthropic` | Claude Pro/Max | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | ChatGPT | `OPENAI_API_KEY` |
| Google（Gemini） | `google` | | `GEMINI_API_KEY` |
| GitHub Copilot | `github-copilot` | Copilot | |
| DeepSeek | `deepseek` | | `DEEPSEEK_API_KEY` |
| 月之暗面（Kimi） | `moonshotai-cn`、`kimi-coding` | Kimi Code（`kimi-coding`） | `MOONSHOT_API_KEY`、`KIMI_API_KEY` |
| 智谱（GLM Coding） | `zai-coding-cn` | | `ZAI_CODING_CN_API_KEY` |
| 阿里云（通义千问 Token Plan） | `qwen-token-plan-cn` | | `QWEN_TOKEN_PLAN_CN_API_KEY` |
| MiniMax | `minimax-cn` | | `MINIMAX_CN_API_KEY` |
| OpenRouter | `openrouter` | OpenRouter 账号 | `OPENROUTER_API_KEY` |

完整列表见 `/login` 里的服务商列表，或 pi 的[模型目录](https://pi.dev/models)。

```bash
export DEEPSEEK_API_KEY=sk-...          # macOS / Linux
$env:DEEPSEEK_API_KEY = "sk-..."        # Windows PowerShell
```

同一个服务商有多处凭据时，按以下顺序取第一个：命令行 `--api-key`、`/login` 保存的凭据、`models.json` 中的 `apiKey`、环境变量。

### 方式三：第三方中转与自建服务（`models.json`）

兼容 OpenAI / Anthropic / Google 接口的服务，例如 API 中转站、Ollama、vLLM、LM Studio，写进 `~/.2pi/agent/models.json` 即可，格式与 pi 的完全相同：

```json
{
  "providers": {
    "my-api": {
      "baseUrl": "https://api.example.com/v1",
      "api": "openai-completions",
      "apiKey": "$MY_API_KEY",
      "models": [
        { "id": "model-id", "reasoning": true, "input": ["text", "image"], "contextWindow": 128000 }
      ]
    }
  }
}
```

- `api`：`openai-completions`（Chat Completions，最通用）、`openai-responses`、`anthropic-messages` 或 `google-generative-ai`。
- `apiKey`：可以是字面值、`$环境变量`，或 `!命令`（每次请求时执行，命令的输出就是 Key）。也可以不写，改用 `/login my-api` 把 Key 存进 `auth.json`。
- 保存后打开 `/model` 就能看到新模型，`/model` 每次打开都会重新读取这个文件。

### 从 pi 或 codex 导入

```bash
2pi import-pi                                  # 导入 ~/.pi/agent 的 provider、模型设置和默认模型
2pi import-codex --model <模型> --thinking xhigh   # 导入 ~/.codex/config.toml 中的自定义 provider
```

导入时不复制密钥本身。只引用密钥的凭据（`!命令`、`$环境变量`）会原样复制；pi 里保存的 API Key 和 OAuth 令牌，在 2pi 中 `/login` 一次即可；codex 的 Key 在每次请求时从 provider 的 `env_key` 环境变量或 `~/.codex/auth.json` 读取。想直接共用 pi 的整个配置目录，设置 `TWOPI_USE_PI_CONFIG=1`。

### 检查登录状态

```bash
2pi auth check --provider deepseek
```

<details>
<summary>pi 与 2pi 的名称对照</summary>

| | pi | 2pi |
|---|---|---|
| 配置目录 | `~/.pi/agent` | `~/.2pi/agent` |
| 凭据（`/login` 写入） | `auth.json` | `auth.json` |
| 第三方 / 自建服务 | `models.json` | `models.json` |
| 设置（默认模型等） | `settings.json` | `settings.json` |
| 配置目录变量 | `PI_CODING_AGENT_DIR` | `TWOPI_CODING_AGENT_DIR` |
| 会话目录变量 | `PI_CODING_AGENT_SESSION_DIR` | `TWOPI_CODING_AGENT_SESSION_DIR` |
| 其他进程变量 | `PI_OFFLINE`、`PI_CACHE_RETENTION`、`PI_TRUE_COLOR` … | `TWOPI_OFFLINE`、`TWOPI_CACHE_RETENTION`、`TWOPI_TRUE_COLOR` … |
| 凭据检查 | `pi auth check --provider X` | `2pi auth check --provider X` |

</details>

## 五分钟上手

下面以"根据实验材料写论文的 Methods 和 Results 两节"为例，走一遍完整流程。

### 1. 建立项目

```bash
mkdir my-paper
cd my-paper
2pi init paper
```

会生成这些文件：

```text
my-paper/
├── 2PI.md        项目卡：目标期刊、字数上限、是否允许联网检索……
├── materials/    放你的原始材料（agent 只读）
├── notes/        memo.md 中文说明、evidence.json 证据账本
├── paper/        main.tex、sections/*.tex、refs.bib
└── .2pi/         agent 状态：检查点、修改记录（自带 .gitignore）
```

写专利用 `2pi init patent`，两者都要用 `2pi init both`。

### 2. 放入材料，填写项目卡

把实验记录、方法笔记、结果表、图、参考文献放进 `materials/`，支持 PDF、Word、LaTeX、Markdown、TXT、CSV 和图片。

然后打开 `2PI.md`，把知道的填上，例如目标期刊、摘要字数上限，以及是否允许联网检索文献（写"联网检索：允许"）。不知道的留空，agent 不会替你编造。

### 3. 启动，说出你的需求

```bash
2pi
```

第一次启动先 `/login`（见[登录模型](#登录模型)）。然后在输入框里直接用中文说需求：

```text
根据 materials 写 Methods 和 Results 两节
```

其他说法也可以，例如"写一篇完整初稿""先列出材料能支撑的主要结论，再开始写""检查 Results 里的每个数字能不能在材料中找到出处"。

### 4. 看它工作

界面左边是对话和工具调用，一行一条，`ctrl+o` 展开完整输出。右边的流程面板显示这一轮走到了哪一步：

```text
⠙ 编辑 paper/sections/results.tex…    1:05
工具 6 · 41k tokens · 回环 1

◆ 根据 materials 写 Methods 和 Results 两…
├─● 解析材料                  已解析 12 页
├─▾ 论文                               2/4
│ ├─● 证据账本                 已记录 9 条
│ ├─⠙ 撰写论文 ×2  paper/sections/results…
│ │ ├ ✓ 写入 paper/sections/methods.tex
│ │ └ ⠙ 编辑 paper/sections/results.tex
│ ├┄● 编译 PDF                       14 页
│ └┄✗ 论文检查  2 错误 · 0 警告 ↺ 撰写论文
├┄○ 交付前检查
╰┄◇ 完成
```

实线分支是走过的步骤，点线分支是还没走到的；正在做的步骤下面列出它最近的几次调用。上图中论文检查没有通过，`↺ 撰写论文` 表示模型回去改稿，"撰写论文"旁的 `×2` 是第二次经过，它后面的步骤变暗，等重新走到再点亮。这一轮没有用到的分组（比如写论文时的"专利"）折叠成一行，点击分组可以展开或折叠。

按 `F3` 切换到树状图，看这一轮是怎么一步步长出来的：每到一个步骤就长出一个子节点，回头重做时从分叉处长出新枝，没走通的那根枝留着、变暗：

```text
          ◆ 根据 materials …
                   │
              ● 解析材料
                   │
              ● 证据账本
            ╭──────┴───────╮
       ● 撰写论文    ⠙ 撰写论文 ×2
            │
       ● 编译 PDF
            │
       ✗ 论文检查
```

点击步骤或节点可以查看它的每次调用，点击面板底部那一行也能切换视图。中间的分隔线可以用鼠标拖动，`F2` 显示或隐藏面板。

运行中可以随时输入补充要求，模型会在下一步看到；按 `Esc` 中断。遇到需要你决定的事情（例如材料中互相矛盾的数据），它会停下来问你。

### 5. 查看结果，不满意就撤回

一轮结束时，稿件已经编译并检查过，你会得到：

- `paper/sections/*.tex`，以及编译好的 `paper/build/main.pdf`
- `notes/memo.md`：中文说明，包括改了什么、材料还缺什么、哪些地方需要你核验
- `notes/evidence.json`：文中每个数字的出处

| 命令 | 作用 |
|---|---|
| `/changes` | 列出每一轮的修改；`/changes c0001` 逐块查看，删除的字划线，新增的字加下划线 |
| `/redline` | 生成修订稿，并在浏览器中打开审阅页 |
| `/undo` | 撤回上一轮 agent 对文件的修改 |

### 6. 接着写专利

在同一个项目里输入：

```text
/init patent
/patent paper/build/main.pdf
```

`/init patent` 把项目卡的类型改成 `both`，并建立 `patent/` 目录；`/patent` 开始转写，论文阶段记下的证据直接作为源事实。

命令后面可以加撰写模式：`direct`（默认，直接成稿，缺口标【待补充】）、`human-in-loop`（先和你确认发明点与权利要求规划）、`text-only` 或 `claims-only`。附图、DOCX、撰写说明和 PDF 都生成在 `patent/out/`。

如果只有一篇现成的论文、想直接写专利：先 `2pi init patent`，把论文 PDF 放进 `materials/`，启动 `2pi` 后输入 `/patent materials/paper.pdf`。

### 7. 不进界面，一条命令跑完

```bash
2pi -p "根据 materials/ 写论文的 Methods 和 Results 两节"
```

完成后自动退出。之后想回到这次会话继续，执行 `2pi -c`。无界面模式下，需要你确认的操作一律拒绝。

## 常用命令

交互界面内：

| 命令 | 作用 |
|---|---|
| `/init [paper\|patent\|both]` | 建立项目 |
| `/paper status\|init [模板]\|check\|compile\|final` | 论文状态、骨架（article/elsarticle/ieeetran）、检查、编译、投稿前检查 |
| `/patent <论文> [direct\|human-in-loop\|text-only\|claims-only]` | 开始专利转写 |
| `/review <草稿> [论文]` | 审查已有的专利草稿 |
| `/plan` | 查看 agent 当前的计划 |
| `/changes [编号]` | 列出各轮修改；带编号时逐块查看（字词级差异与修改原因） |
| `/redline [编号\|起..止]` | 生成修订稿并打开审阅页：HTML 审阅页、论文 latexdiff PDF、专利 Word 修订模式 DOCX |
| `/undo [force]` | 撤回上一轮 agent 对文件的修改 |
| `/checkpoints` | 列出文件检查点 |
| `/research [works\|patents\|log]` | 调研库与检索日志 |
| `/setup` | 设置检索服务的 key（OpenAlex、EPO OPS）和本项目的联网检索许可，填写后立即验证 |
| `/doctor` | 检测模型登录、Python 及依赖、LaTeX、PDF 预览、LibreOffice 和各检索服务，逐项给出修复办法 |
| `/panel [on\|off\|track\|tree\|百分比]` | 显示或隐藏右侧流程面板，切换步骤轨道与树状图，或设置左栏宽度 |
| `/login`、`/logout`、`/model`、`/thinking` | 登录与模型 |
| `/resume`、`/tree`、`/compact` | 会话管理（pi 自带） |

命令行：

| 命令 | 作用 |
|---|---|
| `2pi` | 在当前目录启动交互界面 |
| `2pi init <paper\|patent\|both>` | 建立项目 |
| `2pi "请求"` | 带初始请求启动 |
| `2pi -p "请求"` | 无界面运行，完成后退出；加 `--mode json` 输出 JSON 事件流 |
| `2pi -c`、`2pi -r` | 继续上一次会话、选择历史会话 |
| `2pi --model <provider/id>` | 指定本次使用的模型，`2pi --list-models` 列出可用模型 |
| `2pi --full-access` | 关闭写入沙箱与高危命令确认 |
| `2pi --help` | 全部参数 |

## 功能详解

### 项目布局

```text
2PI.md          项目卡：类型、目标期刊与字数上限、专利撰写模式、公开状态、是否允许联网检索
materials/      原始材料（agent 只读）
notes/          中文说明 memo.md、证据账本 evidence.json（论文与专利共用）、专利事实清单
paper/          main.tex、sections/、refs.bib、figures/、build/
patent/         patent.json、out/（附图、DOCX、撰写说明、PDF、preview/）
research/       调研报告
.2pi/           agent 状态：解析后的论文 sources/、检查点 history/、修改记录 changes/、检查报告 reports/、临时文件 scratch/
```

`.2pi/` 自带 `.gitignore`，不会进入你的 git 仓库。论文、材料和草稿是私有材料，不要提交到公开仓库。research2paper 的 `PAPER.md` 仍可识别。

### 工具

| 工具 | 领域 | 作用 |
|---|---|---|
| `paper_ingest` | 共用 | PDF/DOCX/TeX/MD/TXT → 带页码的全文、页面图、图表与章节索引、公开状态线索 |
| `evidence` | 共用 | 证据账本：记录、修改、删除、查询事实与出处 |
| `compute_stats` | 共用 | 比率、差值、百分点、相对变化的精确计算，可直接读 CSV 单元格，结果自动入账 |
| `pdf_preview` | 共用 | 把 PDF 页面渲染成图片给模型看 |
| `update_plan`、`ask_user` | 共用 | 自主计划、人在回路提问 |
| `paper_init`、`check_draft`、`latex_compile`、`fill_gaps`、`bib_lookup` | paper | 骨架、检查器（含账本数字核对 V01）、编译、填补缺口、Crossref 核对参考文献 |
| `patent_check`、`patent_build` | patent | 专利形式自检；附图 → DOCX → PDF |
| `lit_search`、`lit_fetch` | research | 文献检索（OpenAlex 题名与摘要、arXiv、Crossref 兜底）、按编号核实单篇并给出 BibTeX、下载开放获取 PDF |
| `patent_search`、`patent_import` | research | 专利检索（EPO OPS；未配置时给出 Google Patents / Espacenet 链接）、导入数据库导出的 CSV |

### 交付前检查

模型准备结束一轮时，2pi 自己检查这一轮改过的东西：论文编译 LaTeX 并运行检查器，专利运行形式检查。有错误就把报告交给模型进入修复轮，每次请求最多两轮，用完后如实报告剩余问题。只有模型能做的事（例如查看生成的专利附图与预览页）列为待办。

### 调研与引用核验

调研（相关工作、idea 查新式调研、专利现有技术检索）由辅助领域 research 负责，论文和专利项目都能用。项目卡允许联网检索时自动启用，用过一次之后保持启用。

- **配置与检测**：`/setup` 打开设置菜单：填写 OpenAlex API key（可选，提高文献检索额度）、EPO OPS 账号（可选，用于专利检索），开关本项目的联网检索。key 保存在 `~/.2pi/agent/services.json`（Windows 下是 `%USERPROFILE%\.2pi\agent\services.json`），不必设置环境变量；同名环境变量仍然有效且优先。填写后立即发一次测试请求：服务拒绝的 key 不会保存，原来的设置保持不变。也可以直接输入 `/setup openalex <key>`、`/setup epo <key> <secret>`、`/setup clear openalex|epo`、`/setup online on|off`，`/setup status` 查看当前设置。`/doctor` 对每个检索服务发一次固定的测试请求（不含项目内容），连不上、key 无效、额度用完都会写明原因和办法；设置了 `TWOPI_OFFLINE=1` 时跳过联网检测。两个命令在无界面运行时也能用，例如 `2pi -p "/doctor"`，结果直接打印出来。
- **联网授权**：只有项目卡写了"联网检索：允许"（`/setup` 中可以开关），或你在终端里对本会话确认过，才会发出请求；只发送检索词，不上传论文、稿件或材料。尚未申请的发明，检索词本身也可能泄露发明点，所以 research skill 要求用领域通用词检索。
- **检索日志**：每次联网请求（服务、检索式原文、时间、结果数）记在 `.2pi/research/searches.jsonl`，`/research log` 查看。
- **调研库**：检索、获取、导入的文献与专利，以及 `bib_lookup` 在 Crossref 或 DataCite（arXiv 的 DOI 注册在这里）确认存在的 DOI，存入 `.2pi/research/library.json`。
- **引用核验**：交付前检查扫描本轮写入的 Markdown、LaTeX、.bib 和 JSON。DOI、arXiv 编号、专利公开号如果既不在调研库，也不在作者材料或已解析的论文里，就可能是凭记忆写的，模型必须核实、删除，或明确标注"待核实"。
- **专利数据库**：在 `/setup` 中填写 EPO OPS 账号（EPO Open Patent Services 免费注册，也可以用环境变量 `TWOPI_EPO_OPS_KEY`、`TWOPI_EPO_OPS_SECRET`）后可以直接检索全球专利，包括中国专利。未设置时 `patent_search` 不联网，只给出检索式与 Google Patents / Espacenet 链接；你检索后把导出的 CSV 放进 `materials/`，agent 用 `patent_import` 导入。
- **产出**：调研报告写在 `research/<主题>.md`；专利的检索式与对比文件候选写进专利 JSON 的 `notes["检索与对比文件"]`，生成在撰写说明中，不进申请文本。调研只报告检索范围内看到了什么，不下新颖性或创造性结论。

### 检查点与修改记录

每轮开始和结束时，2pi 都把项目目录存进一个影子 git 仓库（`.2pi/history`，与你自己的 git 完全隔离），并把这一轮的改动记成一条修改记录（`.2pi/changes/cNNNN.json`），`/undo` 可以撤回。两轮之间你手动改过的文件会单独存档：撤回 agent 的修改时，会跳过你之后又改过的文件，除非用 `/undo force`。工作目录文件超过 5000 个时（例如误在家目录启动），检查点自动关闭。

修改记录按"块"记录改动，而不是按行：专利按申请文件的结构（发明名称、摘要、每一项权利要求、说明书每一段、每张附图、撰写说明），论文按 LaTeX 段落（标题取所在的节，如"Methods 第2段"），证据账本按条目，其他文本按段落。块用内容序列比对对齐，插入一项权利要求不会把后面的权利要求都标成改动。模型修订已有稿件后，用 `report_changes` 写一句总结和每处关键修改的原因，原因挂在对应的块上：

- **终端**：每轮结束显示"本轮修改：patent.json：权利要求1、说明书·具体实施方式 第3段……"和原因；`/changes c0004` 打开可滚动的逐块视图。
- **HTML 审阅页**（`/redline`，写到 `.2pi/review/<编号>/review.html` 并用浏览器打开）：整篇文档按块排列，改动处红删绿增、标出原因，未改动的段落折叠。
- **修订稿**（同一目录）：专利是 Word 修订模式 DOCX，每处改动都是一条可以单独接受或拒绝的修订，原因作为批注；论文是 latexdiff 生成的修订版 PDF（需要 TeX Live 自带的 latexdiff）。

### 终端界面

- **启动标题**：一本摊开的书，"2π"一笔写成，左页是"2"，底笔跨过书沟升成右页的"π"：论文与专利是同一项工作的两页。渲染方法和配色借鉴 codex 的标志：盲文点阵、受光的立体笔画，浅色终端改为单色。全屏模式启动时书从书脊处打开。
- **左右分栏**（默认开启）：左侧约 70% 是对话与工具输出，右侧约 30% 是流程面板。分隔线可以用鼠标拖动，宽度会记住；`F2` 或 `/panel on|off` 显示或隐藏，`/panel 65` 把左栏设为 65%。终端窄于 90 列时自动收起；`TWOPI_SPLIT=0` 关闭分栏。
- **流程面板**：默认是挂在请求下面的步骤轨道，论文和专利的步骤各成一组。2pi 不写死工作流，每次工具调用点亮它所属的步骤，例如 `patent_check` 点亮"形式检查"，写 `.tex` 点亮"撰写论文"。正在做的步骤下列出最近的调用；模型回到前面的步骤时，没通过的步骤标出 `↺` 和去向，步骤旁标出经过次数；这一轮没用到的分组自动折叠。`F3` 或 `/panel tree|track` 切换到树状图：这一轮每到一个步骤长出一个节点，回头重做时分叉，选择会记住。顶部是当前动作、用时、工具调用次数、token 与回环次数，下方是模型的计划；网络中断时显示重连倒计时。
- **工具调用一行一条**：`✓ 读取  paper/sections/methods.tex  42 行 · 0.3s`；失败时标红并列出原因。`ctrl+o` 展开 pi 原来的完整输出。
- **交付前检查一行摘要**：`◆ 交付前检查  专利 0 错误 4 警告 · 引用待核实 2 处  自动修复 1/2`，`ctrl+o` 展开完整报告。
- 首次启动时写入几项默认设置：启动时不列出加载的资源、折叠思考过程、对话里不显示页面图片（模型照样能看到）、断流重试 5 次。已有的设置不覆盖，之后可以用 `/settings` 修改。设置 `TWOPI_CLASSIC_UI=1` 恢复 pi 原来的样式。

### 断线重连

参考 codex 的机制（`codex-rs/core/src/responses_retry.rs`），分三种情况处理：

1. **偶发失败**（限流、5xx、流中途断开）：在同一请求上有限次重试，指数退避，共 5 次（1、2、4、8、16 秒），遵守服务端的 Retry-After。
2. **网络断开**（DNS 解析失败、连接被拒或被重置等）：重试用完后不结束这一轮，而是等待网络恢复。按 5 秒起、每次翻倍、最长 60 秒的间隔向模型服务（配置了 `HTTPS_PROXY`/`HTTP_PROXY` 时向代理）发起 TCP 探测，恢复后**从中断处继续这一轮**，不用重新输入。等待期间显示探测次数与倒计时，`Esc` 取消。交互界面一直等待；无界面运行最多等 `TWOPI_RECONNECT_MAX_WAIT` 分钟（默认 10）。
3. **等待无济于事的错误**（额度、计费、鉴权失败、请求无效、上下文超长）：立即结束并报告，不重试。

### 安全边界

- `materials/` 与 `.2pi/`（`.2pi/scratch/` 除外）不可写；论文原件、知识库和工作目录外的路径需要确认。
- 稿件区域（`paper/`、`patent/`、`notes/` 中 agent 的文件）之外，已有的文件可能是作者的原稿：修改需要确认，修订应写到新文件。
- 上传文件、改写或推送 git 历史、工作目录外的递归删除、修改 `materials/` 的命令、下载即执行等操作需要确认。
- 无界面模式（`-p`）下，需要确认的操作一律拒绝。`--full-access` 关闭以上限制。
- 上级目录中的 `AGENTS.md`、`CLAUDE.md`（写给编程助手的仓库说明）不会注入 2pi 的提示词；项目自己目录里的会注入。
- `bib_lookup` 只把被引文献的 DOI、题目、第一作者和年份发给 Crossref，不发送稿件内容。

### 环境变量

<details>
<summary>展开全部环境变量</summary>

前缀是 `TWOPI_`（环境变量名不能以数字开头）。

| 变量 | 作用 |
|---|---|
| `TWOPI_CODING_AGENT_DIR` | 配置目录（默认 `~/.2pi/agent`，即 pi 的 `PI_CODING_AGENT_DIR`；旧名 `TWOPI_AGENT_DIR` 仍可用） |
| `TWOPI_CODING_AGENT_SESSION_DIR` | 会话目录（即 pi 的 `PI_CODING_AGENT_SESSION_DIR`） |
| `TWOPI_OFFLINE`、`TWOPI_TELEMETRY`、`TWOPI_CACHE_RETENTION`、`TWOPI_HARDWARE_CURSOR`、`TWOPI_HYPERLINKS`、`TWOPI_PROGRAM_STATUS`、`TWOPI_IMAGE_PROTOCOL`、`TWOPI_TRUE_COLOR`、`TWOPI_TUI_ESC_TIMEOUT`、`TWOPI_SHARE_VIEWER_URL` | 与 pi 的同名 `PI_*` 变量相同 |
| `TWOPI_HOME` | 配置根目录（默认 `~/.2pi`，配置目录为其下的 `agent`） |
| `TWOPI_PAPER_SKILL_DIR`、`TWOPI_PATENT_SKILL_DIR` | 两个知识库的目录 |
| `TWOPI_PYTHON` | Python 可执行文件 |
| `TWOPI_TECTONIC`、`TWOPI_LATEXMK` | LaTeX 引擎 |
| `TWOPI_PDFTOPPM`、`TWOPI_MUTOOL`、`TWOPI_GS`、`TWOPI_PDFINFO` | PDF 渲染工具 |
| `TWOPI_USE_PI_CONFIG=1` | 复用 `~/.pi/agent` 的登录与配置 |
| `TWOPI_NO_WORD=1` | 不用 Microsoft Word 导出 PDF |
| `TWOPI_OPENALEX_KEY` | OpenAlex API key（不设置时用免费额度，约每天 100 次检索）；也可以用 `/setup` 保存，环境变量优先 |
| `TWOPI_EPO_OPS_KEY`、`TWOPI_EPO_OPS_SECRET` | EPO Open Patent Services 账号，用于专利检索；也可以用 `/setup` 保存，环境变量优先 |
| `TWOPI_CLASSIC_UI=1` | 使用 pi 原来的界面样式 |
| `TWOPI_SPLIT=0` | 不分栏（不显示右侧流程面板） |
| `TWOPI_RECONNECT_MAX_WAIT` | 无界面运行时断网最多等待的分钟数（默认 10；交互界面一直等待） |

</details>

### 在原版 pi 中加载

2pi 也可以作为扩展加载进 pi：

```bash
pi -e path/to/2pi/src/pi-extension.ts
```

## 参与贡献

2pi 欢迎各种形式的贡献，不一定要写代码：

| 如果你擅长 | 可以帮忙的地方 |
|---|---|
| 写论文、审稿 | 改进论文写作规则与检查项（`skills/research2paper`）；补充期刊 LaTeX 模板（`templates/paper/latex/`） |
| 专利撰写、代理 | 改进专利撰写规范、形式检查与附图生成（`skills/paper2patent`） |
| 文献调研 | 完善检索策略（`skills/research`），接入新的文献或专利数据源 |
| 开发 | 新工具、新领域包、终端界面、跨平台兼容 |
| 使用 2pi | 报告 bug、提出需求、分享你的使用流程 |

`skills/research2paper` 与 `skills/paper2patent` 同步自上游仓库 [research2paper](https://github.com/7toCR/research2paper) 和 [paper2patent](https://github.com/7toCR/paper2patent)（来源记录在 `skills/SOURCES.json`）。修改这两个知识库的规则，请优先向上游提交，再用 `npm run sync-skills` 同步过来。

### 报告问题

在 [Issues](https://github.com/7toCR/2pi/issues) 里新建一条，写清楚：

- `2pi --version` 的输出、操作系统和终端（例如 Windows Terminal + PowerShell）；
- 你做了什么、期望看到什么、实际看到了什么；
- 能复现的最小步骤，以及相关的报错信息。

> [!WARNING]
> 提交前请删去 API Key、未公开的论文内容和发明点。issue 是公开的。

### 开发环境

```bash
git clone https://github.com/7toCR/2pi.git
cd 2pi
npm ci --ignore-scripts
python -m pip install -r python/requirements.txt
node bin/2pi.mjs --version
```

改完源码直接运行即可看到效果，不需要编译。常用脚本：

```bash
npm run check         # 类型检查
npm test              # 离线测试：用 faux provider 脚本化模型回复，不调用真实模型、不需要 API Key；装了 LaTeX 引擎时包含真实编译
npm run build         # 编译到 dist/（发布 npm 包时使用）
npm run test:package  # 打包并隔离安装，验证命令和项目初始化；会下载 npm 依赖，不调用模型
npm run sync-skills   # 从 research2paper 仓库同步论文 skill 与 LaTeX 模板
npm run sync-skills -- --patent ../paper2patent  # 从指定 paper2patent 仓库同步专利 skill 与许可证
node scripts/render-logo.mjs  # 修改标识后重新生成 docs/ 下的 README 标识图
```

### 提交 Pull Request

1. Fork 本仓库，从 `main` 新建分支。
2. 一个 PR 只做一件事。在描述里写清动机和验证方式；改动界面时附上截图。
3. 提交前确认 `npm run check` 和 `npm test` 都通过；新功能或修复请补上测试（`test/`）。
4. 代码风格与周围保持一致：TypeScript、Tab 缩进，注释说明"为什么"而不是"做了什么"。
5. 用户能看到的变化请同步更新 README；设计上的变化请更新 [DESIGN.md](DESIGN.md)。
6. 不要提交私有材料：论文、专利草稿、`materials/`、API Key。`.gitignore` 已经排除了常见的工作目录，提交前仍请检查 `git status`。

想做较大的改动（新领域包、新数据源、交互方式变化）时，建议先开一个 issue 讨论方案。设计思路见 [DESIGN.md](DESIGN.md)，分阶段计划见 [ROADMAP.md](ROADMAP.md)。

<details>
<summary>代码结构</summary>

```text
src/cli.ts、env.ts          启动器：独立配置目录 + pi main() + 2pi 扩展
src/extension.ts            装配内核与领域包，分层系统提示词
src/core/                   与领域无关的内核
  prompt.ts                 提示词各层
  project.ts                项目卡 2PI.md、项目布局、证据账本位置
  evidence.ts、stats.ts     证据账本、精确计算
  checkpoints.ts、history.ts 影子 git 检查点、修改记录、/undo /checkpoints
  blocks.ts、blockdiff.ts   块模型、块对齐与字词级差异
  review.ts、changes-view.ts、review-html.ts、redline.ts  块级变更、/changes 查看器、HTML 审阅页、/redline
  guard.ts、gate.ts         写保护与命令审批、交付前检查
  office.ts、pdf.ts         Word 导出 PDF、PDF 渲染
  online.ts                 联网授权、请求与重试、检索日志
  reconnect.ts              断线重连：断网时探测网络、恢复后续跑（参考 codex）
  codex-import.ts、pi-import.ts、branding.ts  按 pi 原生格式导入 codex / pi 配置，帮助文本中的 2pi 名称
  tools/                    paper_ingest、evidence、compute_stats、pdf_preview、update_plan、ask_user、report_changes、redline
src/packs/paper/            论文领域包（移植自 research2paper）
src/packs/patent/           专利领域包
src/packs/research/         调研辅助领域：文献与专利来源、调研库、引用核验
src/ui/                     终端界面：一行式工具调用、检查报告摘要、挂件、首次启动的默认设置
  banner.ts、logo.ts        启动标题；点阵标识（书与连笔 2π 的几何、codex 式光照与盲文栅格化）
  split.ts、flow.ts         左右分栏（可拖动分隔线）与右侧流程面板
skills/research/            调研 skill（2pi 自有：检索策略、调研报告模板、现有技术检索）
skills/research2paper/      论文 skill（规则与检查脚本），同步自 research2paper
skills/paper2patent/        专利 skill（规则、检查与生成脚本），同步自 paper2patent
templates/                  2PI.md 与论文 LaTeX 骨架
python/                     论文解析（ingest_paper.py）、Word 修订模式 DOCX（redline_docx.py）
scripts/                    打包检查、隔离安装测试、skill 同步、README 标识图
test/                       离线测试
```

</details>

<details>
<summary>打包与发布到 npm（维护者）</summary>

`package.json` 的包名和 `package-lock.json` 的根包名需保持一致，`bin` 中的命令名保持 `2pi`。在仓库根目录执行：

```bash
npm ci --ignore-scripts
npm run test:package
npm pack
```

`npm pack` 自动执行类型检查、编译和资源检查，生成 `7tocr-2pi-<版本>.tgz`。发布文件由 `files` 白名单限定：编译后的代码、知识库及其许可证、模板和 Python 脚本；源码、测试、参考仓库、开发缓存和 Python 缓存都不进包。包中不捆绑 `node_modules`，安装时由 npm 安装运行依赖。

pi 的配套模块固定在一起验证过的 1.1.0，避免安装时被上游间接依赖的版本范围带到不兼容的版本。升级 pi 时应一起升级这些模块，再运行隔离安装验证。

发布需要 npm 账号，并按 [npm 的要求](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification)开启双重验证：

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish ./7tocr-2pi-<版本>.tgz --access public --registry=https://registry.npmjs.org/
npm view @7tocr/2pi version --registry=https://registry.npmjs.org/
```

同一版本不能重复发布；下次发布前先升版本号，例如 `npm version patch --no-git-tag-version`，再重新验证、打包和发布。

</details>

## 致谢

- [pi](https://pi.dev)：2pi 的底座，提供 agent 内核、终端界面和模型接入。
- [codex](https://github.com/openai/codex)：断线重连机制和启动标识的渲染方式参考了它的实现。
- [research2paper](https://github.com/7toCR/research2paper) 与 [paper2patent](https://github.com/7toCR/paper2patent)：论文与专利两个知识库的来源。
- [OpenAlex](https://openalex.org/)、[arXiv](https://arxiv.org/)、[Crossref](https://www.crossref.org/)、[EPO Open Patent Services](https://www.epo.org/en/searching-for-patents/data/web-services/ops)：文献与专利检索的数据来源。

## 许可证

[MIT](LICENSE)。`skills/research2paper` 与 `skills/paper2patent` 各自附带许可证（同为 MIT）。
