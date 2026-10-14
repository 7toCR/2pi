---
name: research2paper
license: MIT
description: Turn real research material (method notes, experiment records, result tables, figures, references, an existing draft or reviewer comments) into an evidence-bound SCI original research paper draft, or work on one part of it — Introduction, Methods, Results and Discussion, Conclusion/Abstract/Title, figure and table captions — draft point-by-point responses to reviewers, and run a pre-submission check. Follows DR_CAN's SCI writing lessons; English manuscript text with Chinese notes by default; every missing fact becomes a MISSING marker instead of a guess. Use whenever the user wants to 写论文/写SCI/出论文初稿/改引言/写方法/写结果与讨论/写结论摘要/起标题/写图注/回复审稿意见/写返修回复信/投稿前检查, or says "turn my experiments into a paper", even without naming the skill.
---

# Research2Paper

Help the author turn research they actually did into a paper draft they can verify line by line. The draft organises and explains the author's evidence; it never adds evidence. Say once in the delivery that it is a draft for the authors to check, not a guarantee of acceptance.

## What good looks like

1. **One storyline.** Research problem → specific gap in prior work → this paper's method → actual results → contribution the results support. Every section serves that chain; the Introduction promises exactly what the Results deliver and the Conclusion answers the Introduction.
2. **Every statement traceable.** Numbers, settings, methods, comparisons, novelty and citations come from the author's material or from a source you actually read. Teaching examples (DR_CAN's football and fan-age examples, template wording) are never research facts.
3. **Visible gaps, short markers.** Missing facts are short `[MISSING: specific information]` markers in the English text and listed again in the Chinese notes, with the explanation there. A draft that looks complete but hides its gaps is worse than one that names them.
4. **Claim strength matches evidence.** No "significant" without a test, no causal claim from correlation, no "first" or "state-of-the-art" without a search and a fair comparison, percentage points kept apart from relative change.
5. **Sections do their own job.** The Introduction opens with the specific tension, compares prior work with this paper along the design's own axes (mechanisms, not names or adjectives) and closes with named contributions; Methods explain each component's purpose before its procedure and move implementation conventions out of the component text; Results describe, analyse and discuss; the Conclusion rewrites rather than copies; the Abstract contains nothing the body does not.
6. **The paper talks about the research, the memo talks about the draft.** What you could not verify, how the draft was produced, which files disagree and what still needs checking go to the Chinese memo — never into the paper's narrative. Each limitation is stated once where it limits a claim and once in a Limitations paragraph; the Abstract and Conclusion stay on the contribution. A careful draft that reads like an audit log has failed as a paper.

## Workflow

### 1. Intake and scope

- Identify the task: full draft, one section, revision of existing text, figures/captions, reviewer response, or pre-submission check. Do only that scope; a request to fix one subsection does not license rewriting others.
- Choose the depth: **Flash** for a scoped task with sufficient material (extract facts → write → check → deliver); **Pro** for a full paper or cross-section restructuring (storyline first, sections in research order, whole-paper consistency check).
- Read everything supplied before asking for anything: drafts, tables, figures (look at images when you can), reference lists, journal guidelines. Do not ask again for what is already there. Ask only about ambiguities that would change facts or conclusions, and keep working on the parts they do not affect.
- Note the target journal. Its actual author guidelines decide structure, length, numbering and citation style; without them use a generic format and list what was not checked.

Read `references/intake-and-workflow.md` first for the input template, evidence classes and the Flash/Pro steps.

### 2. Evidence sheet (internal)

List the claims the draft will rest on, each with its location (file and section, table/figure number, page, citation key) and one of four classes: **verified** (you read material that supports it), **author-reported** (stated by the author, not checked), **interpretation** (hypothesis; hedge it), **missing or conflicting** (short marker plus memo note; never average, pick the better number or smooth over). Show the sheet only for full drafts, disputed facts, or when asked.

The classes decide wording and memo entries; they are not written into the paper. Verified and author-reported facts are both written plainly as the authors' statements; only interpretations change the wording (hedged verbs). Read `references/paper-layer.md` before drafting: it decides what goes in the paper and what goes in the memo, and how much space boundaries get.

### 3. Storyline (Pro and full drafts)

Write the one-sentence claim and a short section outline. If the gap has no literature support yet, mark it as a position to verify rather than a fact. Do not stop for approval unless the user asked for a checkpoint.

### 4. Draft in research order

Default order, from DR_CAN's lessons: **Methods → Results and Discussion → Conclusion → Introduction (finalised) → Abstract → Title**, with literature reading throughout. For a single-section task go straight to that section. Load only the reference you need:

| Task | Read |
|---|---|
| Every drafting or revision task: paper vs memo, boundary budget, marker discipline | `references/paper-layer.md` |
| Introduction, related work as mechanism comparison, research gap | `references/introduction.md` |
| Methods, detail triage (core / convention / setting), symbols, equations | `references/methodology.md` |
| Results, analysis, discussion, limitations | `references/results-discussion.md` |
| Conclusion, Abstract, Title | `references/conclusion-abstract-title.md` |
| Figure/table planning, captions, figure checks | `references/figures-tables.md` |
| Point-by-point reviewer response | `references/reviewer-response.md` |
| Pre-submission check, final review of a full draft | `references/quality-checklist.md` |
| Where a rule comes from, adjustable rules of thumb | `references/source-map.md` |

An early Abstract is written only when the user explicitly asks for one; label it `Provisional abstract (暂定草稿)`, keep result gaps as markers, and re-check it once the body exists.

### 5. Check

When you can run Python, save the draft (Markdown or LaTeX) to a file — a scratch file is fine when the user wants the text in chat — and run:

```bash
python <skill>/scripts/check_paper_draft.py draft.md
python <skill>/scripts/check_paper_draft.py draft.tex --bib refs.bib --abstract-words 250
python <skill>/scripts/check_paper_draft.py response.md --mode response
python <skill>/scripts/check_paper_draft.py draft.md --final                    # before submission: any marker is an ERROR
python <skill>/scripts/check_paper_draft.py draft.md --export-gaps gaps.json    # then: fill_gaps.py draft.md gaps.json
python <skill>/scripts/check_paper_draft.py draft.tex --ledger evidence.json     # every salient number traced to the evidence sheet
```

`<skill>` is this skill's directory. Fix every `ERROR`; for each `WARN`, fix it or be able to say why it is a false alarm. The checker catches what is easy to miss when re-reading your own text: empty or non-standard gap markers, figures/tables/equations cited but not defined (or defined but never cited), citations missing from the reference list, acronyms used before definition, "significant" without statistics, absolute differences written as relative percentages, unsupported "first/novel/state-of-the-art", vague "the figure above" references, numbers in the Abstract or Conclusion that appear nowhere in the body, Conclusion sentences copied from Results, teaching-example leakage, and — in response letters — completion claims ("We have conducted…") next to missing changes. It also flags the writing failures that make a careful draft read like an audit log: drafting or verification remarks inside the paper text, runs of "we do not claim / cannot establish" sentences, an Abstract or Conclusion that spends more than a sentence on limitations, gap markers that carry explanations, method paragraphs that list settings without stating their purpose or that are dominated by implementation conventions, related-work paragraphs that list methods without comparing them, and descriptions that merely restate a method's name ("the Event Parser parses events"). It cannot judge whether a claim is true; the checklist in `references/quality-checklist.md` covers the judgement part. Without a shell, apply the same checklist by hand.

### 6. Deliver

English manuscript text first (or the language the user asked for), then short Chinese notes with only the headings that have content:

- **主要修改**: what changed and why, for revisions.
- **材料缺口**: one line per marker that quotes it verbatim, then says what the author must supply and where it might be found — e.g. "- `[MISSING: random seed and number of runs]`：请提供……（训练日志或配置文件中可能有）". Split into 投稿前必须补齐 and 建议补齐. Quoting lets the checker confirm that no marker was left out.
- **待核验事项**: author-reported facts, unverified citations, journal rules not checked, checks you could not run (raw statistics, images you could not open, rendering), discrepancies found in code, logs or prompt files, and provenance questions (which configuration produced which result). This is where every remark about the material and the drafting goes.

Full-paper display order: Title → Abstract → Introduction → Methods → Results → Discussion → Conclusion → References, adjusted to the journal (merged Results and Discussion, no separate Conclusion, etc.). If output length runs out, say which sections are done and where to continue; never label truncated text as complete. Do not show internal reasoning.

## Rules that matter most

- Fidelity beats completeness: no invented sample sizes, metrics, p-values, devices, parameters, datasets, citations, experiments or completion status. A plan stays a plan ("will be evaluated"), not a result.
- Keep existing citation numbers/keys and their mapping. Author-supplied references may stay but are listed as unverified until checked; with no source, write `[MISSING: source supporting this statement]` — never a plausible-looking bibliography entry.
- Reading a summary table is not recomputing statistics; checking a bibliographic record is not checking that the paper supports the sentence; reading a caption is not inspecting the figure. Report each check at the level it was actually done — in 待核验事项, not in the paper.
- Necessary qualifications are never deleted to make the paper look stronger; they are placed once, where they do their work. Placement is the fix for over-hedging, not removal.
- When the authors supply their own draft, it is the base: revise it, keep their structure, terms and voice, and bring in improvements at the places that need them. A revised sentence keeps every specific fact of the original; smoother but vaguer is worse.
- Relocate, don't delete: implementation conventions move to an implementation-details paragraph or the supplement; limitations move to their claim and the Limitations paragraph. Nothing the authors need is lost.
- Gaps are closed with real information, never hidden: search the supplied files first, ask once for the essentials, and before submission run the checker with `--final`.
- Rules of thumb from the lessons (Introduction ≈ 10 % of the paper, references from the last 5 years, ~20 references, Roman table numbers, three-sentence abstract background, one or two conclusion paragraphs) are defaults, never overrides of the journal or the field.
- Do not overwrite the author's original files; save edits as new files unless the user authorises in-place changes. Treat `DR.Can.md` and other source notes as read-only.
- No acceptance probabilities, quality scores or "meets SCI standards" verdicts.

## Common requests

| Request | What to do |
|---|---|
| 根据这些实验记录写一篇英文论文初稿 | Pro: evidence sheet → storyline → sections in research order → checker → notes |
| 只改这段 Introduction，保留引用编号 | Flash, `introduction.md`; report whether the gap is supported |
| 分析这张结果表，写一段结果讨论 | Flash, `results-discussion.md`; separate findings from interpretations |
| 帮我写摘要和题目 | `conclusion-abstract-title.md`; from the finished body, three distinct title candidates plus a recommendation |
| 写图注 / 检查图表 | `figures-tables.md`; visual checks only for images you can see |
| 逐条回复审稿意见（补充实验还没做） | `reviewer-response.md`; working draft with markers, no "We have conducted" |
| 投稿前帮我检查一下 | `quality-checklist.md` + checker; report by priority, do not rewrite the paper |
| 相关工作写得像罗列 / 说清和已有工作的差别 | `introduction.md` § Related work: build the axis grid, write by axis in parallel factual form, put the grid in the memo for checking |
| 我把缺的信息给你了 / 补齐缺口 | Fill pass (`paper-layer.md` § Closing gaps): `--export-gaps` → `fill_gaps.py` → update dependent sentences → `--final` |
| 比较两版稿件 / 以我的稿子为主吸收另一版 | `quality-checklist.md` § Comparing versions: judge per dimension and per section, take the author's draft as base, list which passages to adopt from the other version and why |
