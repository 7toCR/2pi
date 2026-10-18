# Search strategy: from features to queries

## 1. Decompose

Write the idea or claim 1 as features F1…Fn (one technical element each), plus the problem it solves and the application field. Mark which features carry the contribution; queries are built around those, with the rest as context.

## 2. Vocabulary per feature

| Feature | English terms | 中文术语 | Broader | Narrower | Classes |
|---|---|---|---|---|---|
| F1 adaptive window split | adaptive window, window splitting, variable-length window | 自适应窗口、窗口拆分、变长窗 | segmentation | dyadic split | G06F 17/14 |

- Use the field's standard terms and the words authors actually use in titles and abstracts; check them against the first results and adjust.
- Patents describe the same thing in broader words ("signal processing unit" for "wavelet denoiser"); add generic phrasings for patent databases.
- For Chinese patents add Chinese terms; most international databases search English titles and abstracts (CN documents carry English abstracts).

## 3. Combine, broad to narrow

1. Problem + field (recall check: do the obvious classic works appear?).
2. Core feature + field.
3. Core feature + second feature.
4. Feature combination with synonyms (the closest-prior-art query).
5. Classification code + core term (patents).

Keep every query in the record, including the ones that returned nothing.

## 4. Syntax by database

| Database | Syntax |
|---|---|
| OpenAlex (title + abstract) | plain words, all must occur; `"exact phrase"`; `|` between alternatives inside one term group is not reliable, run separate queries instead |
| arXiv | `all:word`, `ti:word`, `au:name`, `abs:word`, `AND`/`OR`/`ANDNOT`, `"phrase"`; the tool sends fielded terms (`ti:"Mixtral of Experts"`) as written, joins plain words with AND and turns year limits into a `submittedDate` filter |
| Crossref | free text matched against bibliographic metadata (titles, authors, venues); no abstracts, no Boolean |
| EPO OPS / Espacenet (CQL) | `ta all "w1 w2"` (title+abstract, all words), `ta any "w1 w2"`, `ti=`, `ab=`, `ic=G06F` (IPC), `cpc=G06F17/148`, `pa="applicant"`, `pd within "2015 2024"`, `and`/`or`/`not`, `prox/distance<3` |
| Google Patents | words, `"phrase"`, `OR`, `-word`, `CPC=G06F17/148`, `before:priority:20240101`, `assignee:` |
| 国家知识产权局 专利检索及分析系统 | 字段检索：名称、摘要、权利要求、IPC 分类号、申请日/公开日；运算符 AND、OR、NOT；中文检索词与同义词并列 |

## 5. Known works: look them up, don't search for them

The works a paper must cite by name (the method it builds on, its baselines, every benchmark and dataset it evaluates on) are lookups, not searches. A short or famous title searched as free text drowns in same-titled noise (Crossref returns essays and reprints for "Attention Is All You Need"). In order:

1. `lit_fetch` with the DOI or arXiv id from the author's materials, or one you remember used as a lookup key (check the returned title and first author).
2. arXiv with the full title as a field: `ti:"Mixtral of Experts"`.
3. OpenAlex with the full title in quotes and a one-year window.

Prefer the published version (conference or journal) over the preprint when the record shows one. For a benchmark, cite the paper that introduced it; when the evaluation follows another work's protocol, cite that too.

## 6. Record

For each query: number, database, query exactly as sent, date of search, date limits, hits, number kept after screening. Screening reasons for discarded near-misses help the reader trust the result.
