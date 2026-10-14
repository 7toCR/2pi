# Idea and related-work survey: report template

Write the report in the user's language (Chinese by default) as Markdown. Keep it factual; every statement about a work is backed by what was read.

```markdown
# 调研报告：<idea 的一句话描述>

检索日期：YYYY-MM-DD　数据库：OpenAlex、arXiv（……）　时间范围：……

## 1. 调研问题与范围
<idea 一段话>；特征拆分：F1 ……；F2 ……；F3 ……。
不在本次范围内的：……

## 2. 检索记录
| # | 数据库 | 检索式（原样） | 日期 | 命中 | 保留 |
|---|---|---|---|---|---|

## 3. 相关工作对比矩阵
| 文献 | F1 | F2 | F3 | 方法要点 | 依据 |
|---|---|---|---|---|---|
| [1] 作者 年份 | ● 摘要 | ◐ §3.2 | ○ | 一句话 | 全文 / 仅摘要 |

● 明确公开　◐ 部分或以不同方式公开　○ 在所读内容中未见

## 4. 分组综述
按技术路线分组，每组说明做了什么、与本 idea 的异同（逐特征）。

## 5. 空白与机会
"在本次检索范围内未见同时包含 F1 与 F3 的工作"之类的表述，并写明范围限制。

## 6. 风险与待核实
- 只读了摘要的结论；无法获取全文的文献；待核实的线索（无编号，注明 待核实）。

## 参考文献
[1] 作者. 标题. 出处, 年份. doi:… / arXiv:…
```

Rules:

- The matrix only contains works in the reference list, and the reference list only contains retrieved works.
- A cell is ● only when the work states the feature; inferring it is ◐ with a note.
- "依据" says whether the row rests on the full text or the abstract only.
- Section 5 never claims novelty; it names combinations not seen within the stated scope.
- For a paper's related-work section, the same matrix decides grouping and which works to cite; add the verified works to the bibliography from their fetched records, not from memory.
