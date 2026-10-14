# Sources and Rule Mapping

Read this when explaining where a rule comes from, when a user cites a rule of thumb from the lessons, or when maintaining the skill. It is not needed to draft a paper.

## Sources

1. **Teaching method:** SCI paper-writing lessons by the Bilibili creator [DR_CAN](https://space.bilibili.com/230105574) ([lesson video](https://www.bilibili.com/video/BV1pW411A7C2/)).
2. **Notes:** the organised lesson notes in the repository's `docs/DR.Can.md`, compiled with reference to a [note-taking creator](https://space.bilibili.com/60706948). The notes are the basis of the rules here; the videos were not checked line by line.
3. **This project's additions:** Flash/Pro routing, the nine task templates, gap markers, evidence classes, citation-verification boundaries, cross-section checks, the checker script and the evaluation set. These are engineering additions, not quotes from the lessons.
4. **Format reference:** the README/Prompt/Skill organisation follows [7toCR/paper2patent](https://github.com/7toCR/paper2patent).

This is an independent tool built on the teaching notes, not an official DR_CAN project and not endorsed by DR_CAN or the note author. The MIT licence covers this project's own content; it does not relicense the lessons or the notes.

## Mapping

| Notes section | Principles kept | Skill file | README template |
|---|---|---|---|
| I. Introduction: two questions; background, literature review, thesis statement | Topic + motivation; broad → specific importance; gap from literature; this work | `introduction.md` | 03 Introduction; 01 Flash; 02 Pro |
| II. Facts: paper structure, writing order, review process | Methods first → Results/Discussion → Conclusion; literature throughout; Title/Abstract last; reviewers judge originality, rigour, writing, details | `intake-and-workflow.md`, `quality-checklist.md` | 01 Flash; 02 Pro; 09 Pre-submission |
| III. Methodology: purpose, reproducibility, points 1–3 | Reproducible path by research type; Nomenclature; equation numbering and LaTeX; no padding | `methodology.md` | 04 Methods |
| IV. Results & Discussion: S1, S2, S3 and notes | Quantitative + qualitative description; argument + comparison; meaning / extension / hypotheses; detail what matters | `results-discussion.md` | 05 Results & Discussion |
| V. Figures and tables: points 1–8 | Journal guide first; cite every figure by number; consistency; complete captions; colour + legend; panels; no reuse without citation; keep raw data | `figures-tables.md` | 07 Figures & tables |
| VI. Conclusion, Abstract, Title | Conclusion mirrors the Introduction, no copy; Abstract after the body, four moves; Title = object + method (+ result) | `conclusion-abstract-title.md` | 06 Conclusion / Abstract / Title |
| VII. Reviewer response and advice | Answer every comment; mark changes; polite but not humble; common comment types; infeasible experiments; unreasonable reviewers | `reviewer-response.md`, `quality-checklist.md` | 08 Reviewer response; 09 Pre-submission |

## Rules of thumb kept as adjustable defaults

- Introduction ≈ 10 % of the paper; recent references (≈ 5 years); ~20 references for an 8–12-page paper, 40–60 for a review.
- Figures Arabic, tables Roman; figure captions below, table titles above; "Figure" vs "Fig." per journal.
- Conclusion in one or two paragraphs; Abstract with three sentences of background and one or two of method.
- Title "includes all keywords"; papers with "both simulation and experiment" are viewed favourably; a figure in the Introduction.
- Review timeline (3–5 reviewers, 1 + 2 weeks) and response time (one week to one month): background information, not a promise about any journal.

All of these yield to the journal's guidelines, the field and the article type.

## Clarifications added for reliable execution

- **Writing order.** Notes II give Methods → Results/Discussion → Conclusion with literature throughout and Title/Abstract last; VI says the Abstract is written after all other parts. Finalising the Introduction before the Abstract, and the whole-paper check, are this project's arrangement.
- **Early abstract.** Only on explicit request, labelled provisional, re-checked after the body is done.
- **"Hypotheses to justify yourself"** (S3) becomes: give a hedged explanation for unexpected results and say how to test it — never turn speculation into a causal claim.
- **"Rewrite with a thesaurus"** becomes: reorganise the argument; keep technical terms stable.
- **"No duplicate figure submission; cite if reused"** does not become "modify slightly and reuse": reuse needs citation, permission where required, and compliance with journal policy.
- **Arguing with reviewers.** Using other reviewers' positive comments is allowed as context, but every point still needs a direct, evidence-based answer.
- **Evidence boundaries** (gap markers, evidence classes, citation-check levels, real revision status, teaching-example isolation) are added to stop drafts from going beyond the material.
- **Paper layer and boundary budget** (`paper-layer.md`) were added after a side-by-side review of an author-written paper and a draft this skill produced from the same material. The generated draft was careful about evidence but mixed audit and drafting remarks into the paper, stacked negative positioning sentences, spent much of the Abstract and Conclusion on limitations, and described the method less completely than the author. It also had real strengths worth keeping — a concrete opening tension, explicit design rationale, and result-level distinctions between observation and mechanism — which are now written into `introduction.md`, `methodology.md` and `results-discussion.md` as patterns. DR_CAN's notes already point the same way: the Conclusion "强调所做内容的 Contribution", the Abstract "摘取文章要点", and Methods explain "如何得到这一结果".
- **Mechanism comparison, detail triage and gap closing** were added after a second review compared a draft produced with the paper-layer rules against the same author paper. The new draft ranked first on problem framing and method explanation, but its related work still introduced methods one by one, one revised sentence had lost information (a method described by restating its name), implementation conventions still took more space than design reasons, and unfilled markers kept it from being complete. The fixes are deliberately balanced: contrasts are stated as parallel facts ("X does A; we do B") rather than claims that prior work lacks something; conventions are relocated, not deleted; reasons are never invented; and gaps are closed with real information through a search–ask–fill loop rather than removed.

## Teaching examples (never research facts)

The football proposal ("using technique A to help the Chinese national team reach the World Cup"), the World Cup economics example, AlphaGo, the Bilibili fan-age statistics (61.78 %, 7.11 %) and the lecturer's engine-cooling NAMIMO paper illustrate writing techniques only. They must not appear as data, methods or conclusions in a user's paper (checker W05).

## Known gap in the notes

Section VII, "关于'怼回去'", item 2 ("编辑的态度，如果编辑欣赏……") is incomplete in the OCR'd source. Do not reconstruct it.
