# Quality Checklist

Use before delivering a full draft and for every pre-submission check. Check only the scope requested; a one-paragraph edit does not need a full report. Report what the author needs (open issues, gaps, risks), not the checklist itself.

## A. Automated (`scripts/check_paper_draft.py`)

| Code | Level | Catches |
|---|---|---|
| S01–S03 | WARN | No title, no abstract, a core section missing (full manuscripts only) |
| S04, S05 | ERROR | Abstract or title over the word limit given with `--abstract-words` / `--title-words` |
| S06 | WARN | Citation inside the Abstract |
| S07 | WARN | LaTeX `\input` / `\include` file not found (the checker reads included files and reports their positions as `file line N`) |
| G01 | ERROR | Empty or vague gap marker (`[MISSING]`, `[MISSING: details]`) |
| G02 | WARN | Non-standard placeholder: TODO, TBD, XXX, `??`, `[citation needed]`, `[REF]`, 【待补充】 |
| G03 | INFO | List of all `[MISSING: …]` markers |
| G04 | WARN | Marker not mentioned in the gap notes (section 材料缺口 / Gaps, or `--notes`) |
| G05 | INFO | Markers inside Title/Abstract (acceptable only in a provisional abstract) |
| G06 | WARN | Marker longer than ~15 words: it carries an explanation that belongs in the memo |
| G07 | ERROR | With `--final`: any remaining marker or provisional-abstract label |
| F01 / E01 | ERROR | Figure, table or equation cited but not defined |
| F02 | WARN | Figure or table defined but never cited in the text |
| F03 | WARN | Figures/tables not first cited in numerical order |
| F04 | WARN | Positional reference ("the figure above", "上图") instead of a number |
| F05 | WARN | Mixed numbering styles (Table 2 and Table III) |
| F06 | WARN | Panel cited (Fig. 2c) but the caption has no such panel |
| L01 / L02 | ERROR / WARN | LaTeX: `\ref` to an undefined label; figure/table label never referenced |
| C01 | ERROR | Citation missing from the reference list or `.bib` |
| C02 | WARN | Reference never cited |
| C03 | INFO | Numeric citations not in order of first appearance |
| C04 | WARN | Reference entry without a year (verify the record) |
| A01 / A02 | WARN | Acronym used before its definition / never defined |
| W01 | WARN | "first", "novel", "state-of-the-art", "outperforms all", "fills the gap" … |
| W02 | WARN | "significant(ly)" with no statistical evidence in the paragraph |
| W03 | WARN | "prove", "guarantee", "always", "completely eliminate", "perfect" … |
| W04 | WARN | "by X %" where X equals the difference of two percentages (should be percentage points) |
| W05 | WARN | Teaching-example leakage (DR_CAN's football / fan-age examples) |
| W06 | WARN | Drafting or verification remark in the paper text ("this draft", "the supplied materials", "could not be confirmed from the records", "not recomputed here", "work tree") |
| W07 | WARN | Boundary overload: ≥ 2 limitation/disclaimer sentences in the Abstract or the Conclusion, or ≥ 3 in one paragraph outside the Limitations paragraph |
| W08 | WARN | A description that restates a method's name as its function ("the Temporal Event Parser parses temporal events") |
| W09 | INFO | Related-work paragraph that introduces three or more cited methods one after another without any comparison |
| M01 | INFO | Methods paragraph with several settings and no stated purpose (rationale missing) |
| M02 | INFO | Methods paragraph dominated by implementation conventions (fallbacks, offsets, character limits, minimum counts) outside an implementation-details section |
| N01 | WARN | Number glued to a unit (`10Hz` → `10 Hz`) |
| D01 | WARN | Number in Abstract/Conclusion not found in the body |
| D02 | WARN | Conclusion or Abstract sentence copied from Results/Discussion |
| V01 | WARN | With `--ledger evidence.json`: a salient number in the paper that no ledger entry records at the precision written (small integers, years, figure/table/equation/section numbers and citations are skipped) |
| V02 | INFO | With `--ledger`: number of ledger entries per evidence class |
| R01 | ERROR | Response letter: completed-tense claim next to a missing change or location |
| R02–R05 | WARN | Missing field, skipped comment number, thanks-only response, other reviewers' agreement used as the answer |

Zero ERRORs before delivery. A WARN is acceptable only when you can say why it is a false alarm (a theorem that is actually proved, a field that conventionally leaves an acronym undefined). The checker is heuristic: passing it says nothing about whether the research is true.

## B. Evidence audit

- Every key number, technical detail, comparison and novelty claim has a source; you can say whether it is verified, author-reported or interpretation.
- No content you added without a source; remove it or downgrade it to a labelled hypothesis.
- Conflicting values are reported as conflicts, not resolved by choice.
- Citations: say which were checked as records, which as full text supporting the sentence, which not at all.
- Teaching examples and template wording have not become research facts.

## C. Argument

- The problem and gap raised in the Introduction are answered by the Methods and Results.
- Title, Abstract and Conclusion do not exceed the evidence.
- "First" is not concluded from the absence of related papers in the material.
- Comparisons are fair: same data split, protocol, hardware, or the differences are stated.

## D. Section function

- Introduction leads naturally to the study; Methods contain no unrelated background or textbook derivations; Discussion goes beyond restating data; Conclusion answers the contribution without copying Results.
- Terminology is stable — rewriting has not swapped technical terms for synonyms.
- Unfavourable results are present and discussed.

## E. Journal compliance

Check only against guidelines actually obtained (name the version or access date): article type, sections, word limits, abstract form, figure/table style, reference style. Rules not obtained are listed as unchecked. The notes' rules of thumb (10 % Introduction, last five years, ~20 references, Roman table numbers) are not standards.

## F. Paper layer and information budget

- The paper contains only the research narrative; every remark about the material, the checks and the drafting is in the memo (W06).
- Each limitation appears once at its claim and once in a Limitations paragraph; the Abstract carries at most one sentence of it; the Conclusion ends on the main line, not on to-dos (W07).
- Positioning is positive: what the paper does, on what evidence. No run of "we do not claim …" sentences; no concept introduced only to be denied.
- The Introduction opens with the specific tension the paper resolves and closes with named contributions linked to sections.
- Related work is organised by the design's axes; each contrast states what prior work does and what this paper does (mechanism facts, not adjectives); no "X lacks …" without evidence from X (W08, W09).
- Revisions keep the specific facts of the sentences they replace.
- Implementation conventions sit in an implementation-details paragraph or the supplement, not in the component text (M02); nothing was deleted.
- Gaps: every marker was searched for in the supplied files, is placed where its value goes, and is listed by priority; a submission draft passes `--final` (G07).
- Methods: each component's purpose precedes its procedure; the objects passed between components are named; check/revise loops have triggers and stopping rules; formulas add a decision rule or are presented as notation (M01 flags settings without purpose).
- Explanatory sentences (design rationale, observation vs mechanism) are kept — they are not disclaimers.

## G. Revision status (resubmissions)

Every comment has a response; every completed-tense claim is backed by a real change; locations are verified or marked.

## Reporting

Group findings by impact:

- **优先解决**: factual conflicts, unsupported conclusions, missing key material.
- **建议修改**: argument, readability, consistency.
- **尚未验证**: raw statistics, external references, journal rules, images not viewable, typesetting, locations.

Each item: location, problem, why it matters, concrete fix. If something cannot be located, say which material is needed; never invent page numbers. Say what was read and what was not; a clean partial check is not a pass for the whole paper. Give no scores, acceptance probabilities or "meets SCI standard" verdicts.

Before finishing: every `[MISSING: …]` has a line under 材料缺口.

## Comparing versions

When the user asks which of two drafts is better, or wants to merge them (typically their own draft and a generated one):

- Judge per dimension (language, problem statement, structure and narrative, claim boundaries, method and architecture, information budget) and per section, with locations. Say where each version is stronger; a version that is better overall is rarely better everywhere.
- Separate writing quality from research quality: a more detailed figure or longer method description is not a more advanced system.
- Recommend a base text (by default the author's own draft) and list the specific passages to adopt from the other version, with the reason each one improves the base. Then revise the base in place, keeping the author's voice.
- Never resolve a difference by turning an uncertain statement into a certain one; uncertainty is relocated (to its claim, the Limitations paragraph or the memo), not erased.
