---
name: research
description: Literature and idea surveys and prior-art searches for research papers and Chinese invention patents — search strategy, retrieved-and-verified references only, feature comparison matrix, search record, and the candidate table of closest prior art (检索式、对比文件候选). Use when the user asks for related work, an idea or novelty survey (调研、查新), or a patent search before or after drafting.
---

# Research: literature, idea and prior-art surveys

A survey tells the author what is already out there, how close it is, and exactly how that was established. It is evidence for the author's and the patent attorney's judgement, not a verdict.

## Non-negotiable

1. **Cite only what was retrieved.** Every work and patent in a report comes from a search result, a fetched record, an imported database export, or the author's own materials. Never write a DOI, arXiv id, publication number, author list or year from memory, and never "complete" a partial reference. If you remember a relevant work but cannot retrieve it, describe it without identifiers and mark it 待核实.
2. **No novelty verdicts.** Report what was searched (databases, queries, date limits, search date), what was found and how close it is. Do not conclude 具备新颖性/创造性, "no one has done this", or acceptance and grant prospects. An empty result means only that these queries in these databases found nothing.
3. **Protect unfiled inventions.** Query words leave the machine. Before the patent application is filed, search with the field's public vocabulary (the problem, generic technique names, classification codes) rather than the invention's specific combination of features, parameter values or internal names; never paste claims, draft text or unpublished results into a query.
4. **Read before you judge.** Screen by title and abstract, then read the closest candidates (full text where it is openly available) before stating what they disclose. Say whether a judgement rests on the abstract or the full text.

## Workflow

Do what the request needs, in this order:

1. **Frame.** Write the idea (or claim 1) as a short list of features F1…Fn, the technical problem and the field. Fix the time window: for a patent, publications before the filing or priority date; for a paper, recent years plus the classics the field always cites.
2. **Plan the queries before searching.** For each feature: English and Chinese terms, synonyms, broader and narrower terms; for patents, likely IPC/CPC classes. Combine into 3–6 queries from broad to narrow. Read `references/search-strategy.md`.
3. **Search, screen, snowball.** Run the queries; keep a record of each (database, query as sent, date, hits, kept). Expand from the closest works through the works they cite and the works citing them. Stop when new queries mostly return works you already have.
4. **Compare.** Build a feature matrix: rows are works, columns F1…Fn, each cell ● disclosed / ◐ partly or differently / ○ not found in what was read, with the location that supports it (abstract, §3, Fig. 2, claim 1).
5. **Report.** Idea or related-work survey: `references/idea-survey.md`. Patent prior art (检索式 and candidate table in the 撰写说明): `references/prior-art-search.md`.

## Quality bar

- The search record lets someone else rerun every query.
- Every row of the matrix and every candidate has a retrievable identifier (DOI, arXiv id, publication number) or is marked 待核实.
- Closeness is argued feature by feature; "highly relevant" without a feature comparison is not acceptable.
- Gaps are phrased as "在本次检索范围内未见……", with the scope stated.
