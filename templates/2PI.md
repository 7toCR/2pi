# 2pi 项目卡

2pi 在本目录工作时会读这张卡。知道的填上，不知道的留空；agent 不会替你编造。

## 项目

- 类型：{{type}}
- 名称：
- 语言：中文

可选的类型：paper（材料 → 论文）、patent（论文 → 专利申请初稿）、both（两者都做）。

## 论文

- 目标期刊：
- 作者须知：
- 文章类型：original research
- 摘要字数上限：
- 标题字数上限：
- 引用格式：
- LaTeX 模板：
- 稿件：
- 参考文献：
- 中文说明：
- 证据账本：

字数上限只从这里读取：期刊作者须知写明了才填，agent 不会自己设定。
稿件、参考文献、中文说明、证据账本留空时分别为 paper/main.tex、paper/refs.bib、notes/memo.md、notes/evidence.json。

## 专利

- 撰写模式：direct
- 公开状态：
- 申请人关注点：

可选的撰写模式：direct（直接成稿，缺口标【待补充】）、human-in-loop（先确认发明点与权利要求规划）、text-only、claims-only。
公开状态写：未公开 / arXiv 预印本 / 已录用 / 已发表，并注明日期。

## 调研

- 联网检索：不允许

未公开的想法发给第三方检索服务就等于泄露。只有写成"允许"时，agent 才会联网检索文献或专利。

## 目录

materials/ 放作者原始材料（agent 只读）；notes/ 放中文说明、证据账本和事实清单；paper/ 放论文 LaTeX 源与 build/；patent/ 放 patent.json 与 out/。
