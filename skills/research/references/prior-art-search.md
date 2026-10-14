# Prior-art search for a patent draft (检索式与对比文件候选)

Purpose: give the applicant and the patent attorney a reproducible search record and a short list of the closest documents, so they can judge novelty and inventive step and adjust the claims. It does not replace the attorney's or the examiner's search, and it never states that the invention is novel.

## Inputs

- Claim 1 split into features (use `notes.claim_plan` and the invention points), the technical problem, the field.
- The cut-off: the planned filing date, or the priority date. Documents published after it are not prior art; list them separately if relevant.
- The source paper itself: if it was published before the cut-off it is prior art (see the patent skill's disclosure guidance); do not list it as a "candidate" — it is already known.

## Search

1. Build the vocabulary and queries as in `search-strategy.md`, with English terms for international databases and Chinese terms for CNIPA, plus 1–3 IPC/CPC classes.
2. Search patents and non-patent literature: papers are prior art too, and for algorithmic inventions they are often the closest.
3. Without database access, still write the queries (per database syntax) and leave the search as a handover item; never list candidates you did not retrieve.

## Candidate table

Columns: 序号 | 公开号或 DOI | 标题 | 申请人或作者 | 公开日 | 与权利要求1相关的特征 | 相关度 | 依据 | 来源（检索式#）.

Relevance:

- **X** — alone appears to disclose every feature of claim 1. Only after reading the full text (claims and description); from an abstract, write "X?（初判，依据摘要）".
- **Y** — discloses some features; relevant in combination with another document.
- **A** — general background of the field.

Keep 3–10 candidates, closest first. For each, name the features it discloses and the main difference from claim 1.

## Where it goes

In the patent JSON, `notes["检索与对比文件"]` as a list of strings (rendered in the 撰写说明, never in the application text):

```json
"检索与对比文件": [
  "检索日期与范围：2026-10-10；EPO OPS（全球专利，含 CN 英文摘要）、OpenAlex；公开日早于 2026-10-01。",
  "检索式1（EPO CQL）：ta all \"vibration denoising wavelet\" and pd within \"2010 2026\"（命中 46，保留 5）",
  "检索式2（OpenAlex）：adaptive window wavelet threshold noise floor（命中 120，保留 4）",
  "候选1：CN1XXXXXXXXA｜标题｜申请人｜2021-03-02｜公开了 F1、F2（摘要），未见 F3｜Y（初判，依据摘要）｜检索式1",
  "未完成：国知局中文检索（需申请人或代理师完成，检索式见上）。"
]
```

Then:

- If any candidate may be X, add a risk to `notes.risks` and say so in the delivery message.
- Add "现有技术检索" to `notes.handover` when databases were not available or only abstracts were read.
- The 背景技术 section still cites only documents the paper itself cites; do not move search candidates into the application text unless the user asks.
