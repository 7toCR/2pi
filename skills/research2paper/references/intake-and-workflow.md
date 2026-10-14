# Intake and Workflow

## Input

Extract what you can from the files and text already supplied; ask only for what is missing and decisive. The general template (Chinese, because users fill it in):

```text
【任务】整稿 / 指定章节 / 修改 / 图表与图注 / 审稿回复 / 投稿前检查
【研究问题与动机】研究对象、要解决的问题、为什么重要、已知的研究空白
【方法】输入输出、关键步骤、假设、理论推导或实验设置
【结果】原始或汇总数据、指标定义与优化方向、单位、样本、对照条件、重复次数、统计检验
【图表】图表本体、编号、图注、对应的结果和数据来源
【参考文献】作者提供的条目、DOI、引用键或可读取的全文
【目标期刊】期刊名称、作者指南、文章类型、字数与格式限制（如有）
【已有草稿】需要保留或修改的内容（如有）
【审稿意见】逐条意见、实际完成的修改及其位置（如有）
【语言与交付】默认英文正文、中文说明；默认在对话中给 Markdown
```

What each task needs at minimum:

| Task | Needs |
|---|---|
| Methods | the steps actually performed and their settings |
| Results / Discussion | actual results with metric definitions and comparison conditions |
| Introduction | research problem, contribution, related work (or citation keys) |
| Abstract / Title | a finished body or material covering the whole study |
| Reviewer response | the original comments and evidence of what was changed |
| Pre-submission check | the manuscript; journal guidelines if compliance is in scope |

Open every readable attachment. If something cannot be opened (a corrupted PDF, an image you cannot view), say so; never describe it as reviewed. A file name, an abstract or a caption does not show that you checked the full text, the raw data or the figure.

Only an idea, no results yet: write the outline, research questions and planned methods in future or conditional tense. Never write completed-tense Results for experiments that have not been run.

## Evidence classes

For each claim the draft relies on, keep a short location (file § section, Table 2, Fig. 3b, p. 4, citation key) and one class. The classes steer what you write and what you report in the memo; they are never written into the paper as such.

- **Verified**: material you actually read supports it. Write it plainly in the paper; note the scope of your check in the memo ("依据作者提供的汇总表，未复算原始数据").
- **Author-reported**: the author says so, you could not check. Write it plainly in the paper as the authors' statement; list it under 待核验事项.
- **Interpretation**: a hypothesis or mechanism. Write it with hedged verbs (may, might, is consistent with, suggests) and name what would test it — this one *does* shape the paper's wording.
- **Missing or conflicting**: a short `[MISSING: …]` in the text where the fact is needed; the reason, and for conflicts both sources and values, go in the memo. Never average, never pick the more favourable value, never smooth the narrative over the conflict.

Output the full claim-to-evidence table only for full drafts, disputed facts or on request.

When you can write files, keep the sheet as a JSON ledger so the checker can trace numbers: `{"entries": [{"claim": "SWD met the criterion for 160 of 200 signals", "class": "verified", "source": "results.csv, row SWD"}]}` (classes: `verified`, `author-reported`, `interpretation`, `missing`; an optional `numbers` list overrides the numbers read from the claim). Record derived values (rates, differences, relative change) with the numbers you computed. `check_paper_draft.py draft.tex --ledger evidence.json` then reports every salient number in the paper that no entry records (V01); numbers of `missing` entries never count as recorded.

## Two layers: paper and memo

Read `references/paper-layer.md` before drafting. In short: the paper is the authors' account of their research; everything about the material, your checks and how the draft was made goes to the Chinese memo. Material audits (code, logs, prompt files, repositories) feed the evidence sheet and the memo; they are not part of the paper's narrative. Each limitation is stated once at its claim plus once in a Limitations paragraph; the Abstract carries at most one sentence of it.

When the authors supply their own draft, it is the base text: revise it in place of writing a new one, keep their structure, terminology and voice, and list every change under 主要修改.

## Gap marker format

- Always `[MISSING: specific information]` — say exactly what is missing: `[MISSING: number of independent runs per condition]`, not `[MISSING]` or `[MISSING: details]`.
- Name the item only, in about 12 words or fewer. Why it is missing and what you searched belong in the memo (checker G06).
- Search all supplied files before writing a marker; place it where the value goes; gather reproducibility gaps into one configuration table or sentence. Closing gaps (batched question at intake, prioritised memo list, fill pass, `--final` check) is described in `paper-layer.md` § Closing gaps.
- Citation gaps: `[MISSING: source supporting this statement]`.
- Response letters: `[MISSING: completed analysis and manuscript changes]`, `[MISSING: manuscript location]`.
- Do not use TODO, TBD, XXX, `??`, `[citation needed]` or Chinese placeholders inside the English text; the checker flags them.
- Every marker in the text has one line under **材料缺口** in the Chinese notes that quotes the marker verbatim (``- `[MISSING: …]`：需要作者提供……``); the checker (G04) matches notes to markers by this quotation.

## Flash

For a scoped task with enough material:

1. Extract the facts the task needs and their locations.
2. Write the requested text only.
3. Check facts, citations, numbers and claim strength (run the checker when you can).
4. Deliver the text and the necessary notes.

## Pro

For a full paper or a cross-section restructuring:

1. **Storyline.** One-sentence claim; the chain problem → gap → method → results → contribution; a short outline. An unsupported gap is a position to verify, not a fact.
2. **Draft in research order.** Methods → Results and Discussion → Conclusion → finalise the Introduction → Abstract → Title. Literature reading and citation checking run through every stage. (Methods first, literature throughout and the Abstract last come from the DR_CAN notes; placing the Introduction's final pass and the whole-paper check at specific stages is this project's arrangement.)
3. **Link every main result to its evidence** (table, figure, statistic) and keep findings, interpretations, limitations and future work apart.
4. **Whole-paper consistency.** Names of methods and datasets, metrics, sample sizes, symbols, units, numbers and contributions agree across Title, Abstract, Introduction, Methods, Results and Conclusion. Run the checker on the assembled draft.
5. **Deliver** the draft and the Chinese notes.

Early Abstract: only when the user explicitly asks. Label it `Provisional abstract (暂定草稿)`, keep result gaps as markers, and re-check it after the body is written. This branch never replaces the default order.

Article type: default to an original research article and organise by what the work is — theoretical, empirical or engineering. Do not demand proof, simulation and physical experiment in every paper. Systematic reviews, clinical trials and other types with their own reporting standards (PRISMA, CONSORT, …) follow those standards; say so if the user asks for something else.

## Citations and journal rules

- Keep the author's citation keys or numbers and their mapping to statements.
- Author-supplied entries can stay in References; list unverified ones under 待核验事项 with what was and was not checked.
- When tools allow, read the journal's author guidelines, the publisher page, DOI records and the cited papers themselves. A matching bibliographic record does not prove that the paper supports a specific sentence. Note the access date for guidelines.
- Without network access or guidelines, keep writing what the material supports, mark citations and journal rules as unchecked, and never pad the reference list to reach "about 20" or "last five years".

## Files

- Default: answer in chat as Markdown.
- If the user wants files, or the output is a full paper, save to the location they name, otherwise to a new output folder away from their originals and source notes. LaTeX users get `.tex` that keeps their labels and macros.
- Never overwrite the author's draft unless explicitly authorised for that file; never edit `DR.Can.md`.
- This skill produces text. Figures are plans and captions unless a separate plotting tool is used; a Markdown draft is not a typeset DOCX/PDF, and neither counts as a rendering check.
