# Reviewer Response

Principles from DR_CAN (part VII): keep a good attitude — anything short of rejection is good news; answer every comment carefully; mark every change clearly in the manuscript and the letter (e.g. highlighting); be polite and grateful, and phrase disagreement tactfully — "polite but not humble; a rebuttal, not a quarrel".

## Format

Keep the Reviewer and Comment numbers and the original wording. Compound comments may be split into sub-points, but none may be dropped, including the awkward ones. If the original text is garbled (OCR) or incomplete, keep a marker; do not reconstruct it.

```text
Reviewer [n], Comment [m]
Comment: [verbatim reviewer comment]
Response: [answer supported by the actual revision or evidence]
Changes in the manuscript: [revised text, or a precise summary]
Location: [verified section/page/line, or [MISSING: manuscript location]]
```

Each response answers: what the reviewer is concerned about, how the authors respond, what actually changed or what evidence supports the position, and where. Thanks are one short clause, never a substitute for the answer.

Page and line numbers only after checking the current version. Without stable line numbers, give the section and the opening words of the revised paragraph.

## Wording depends on the real status

| Status | Allowed wording |
|---|---|
| Done and verifiable | "We have revised / added / conducted …" + what + where |
| Analysis done, manuscript not yet updated | Explain the result; do not say it was added to the text; list the pending change in the notes |
| Planned | Working draft only: `[MISSING: completed analysis and manuscript changes]`; no expected results, no completed tense |
| Not possible / disagree | Explain the actual constraint; offer existing alternative evidence, a feasible alternative analysis, or a narrowed claim; keep proposed and completed alternatives apart |

## Common comment types

- **Format, figures, language** (the most common): say exactly what changed and where. Confirm a figure or layout issue is fixed only after seeing the revised output.
- **Background, Abstract, Introduction, Conclusion**: show how the framing changed and how it now connects to the contribution.
- **Add references**: judge relevance first. Add and discuss those that matter, including important work that was missed; a request to cite the reviewer's own papers is followed only where the papers are actually relevant. Unverified entries go into the notes.
- **Novelty / contribution questioned** ("this has been done", "new method but no data"): compare concretely with the closest work and state the boundary of the contribution. The author may need to revisit the work with the supervisor to articulate its value; do not answer with "our method is novel" alone.
- **Experimental details**: add the details or the experiment if it was done. If an experiment cannot be done for objective reasons: propose an alternative analysis or experiment that addresses the concern, document the difficulty (with citations where possible), or support the claim with other evidence — and say which of these is complete.
- **Unreasonable reviewer** (criticism without suggestions): answer every reasonable point thoroughly first. Disagree with evidence and logic, pointing to the specific flaw in the comment. Agreement from other reviewers can add context but never replaces a direct answer to this reviewer's point.

## Output and self-check

English point-by-point response first, then Chinese notes: unfinished changes, evidence gaps, unverified citations, locations to fill. If substantive changes are incomplete, say plainly: "这是工作草稿，需完成所列修改后才能用于返修提交。"

Check: every comment has a response; responses match the actual manuscript; every completed-tense verb is backed by a real change; disagreements address the issue and the evidence. Run `check_paper_draft.py --mode response` to catch completion claims next to missing changes, missing fields, skipped comment numbers and thanks-only responses.
