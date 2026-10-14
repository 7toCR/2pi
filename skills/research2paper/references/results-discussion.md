# Results and Discussion: describe, analyse, discuss

This is the core of the paper (DR_CAN, part IV): find what is meaningful in the data, not a tour of the tables. Figures and tables are its visual language.

## For each main finding

1. **Describe (S1).** Lead with the finding, then support it with numbers and the figure/table number. Combine quantitative statements (exact values) with qualitative ones (overall trend, largest/smallest, main group). Do not restate a table cell by cell.
2. **Analyse (S2).** Explain why it happened and compare conditions: argument (causes supported by evidence) plus comparison (differences between groups, settings or baselines and their reasons). Keep direct evidence, supported mechanisms and untested hypotheses apart.
3. **Discuss (S3).** What the result means for the research question and the contribution, where it applies, its limits, and possible extensions. For results that look wrong or unexpected, do not hide them: give a hedged explanation and say how it could be tested.

Repeat for each finding. Detail the findings that carry the contribution; group minor ones. S3 may cover all three dimensions (meaning, extension, hypotheses) or go deep on meaning alone.

If the journal separates Results and Discussion, Results report findings and Discussion interprets them; if merged, a reader must still be able to tell observation from interpretation.

## Numbers and comparisons

- Keep units, sample sizes, conditions and precision. State each metric's direction (lower RMSE is better).
- **Percentage points vs percent.** For metrics already in percent, the absolute difference is in percentage points; a relative change needs its base. From 80 % to 84 %: "+4 percentage points" or "a relative increase of 5 % (4/80)". Never "improved by 4 %".
- Compute new numbers only when inputs and definitions allow, and state the calculation in the notes.
- Means, error bars, confidence intervals and p-values need actual statistical results. Never invent variance or significance from a single run or a mean.
- "Statistically significant" needs a test; "practically meaningful" needs a domain argument; a better number proves neither. Without a test, write the numbers and use "higher", "lower", "substantially" — not "significantly".
- Values from different splits, hardware, samples or protocols do not establish a fair ranking. Say whether conditions are comparable when citing published numbers.

## Claim-strength ladder

Match the verb to the evidence:

| Evidence | Wording |
|---|---|
| Direct, controlled comparison with adequate statistics | shows, demonstrates (for this setting) |
| Consistent results without a decisive test | indicates, supports |
| Correlation, single comparison, plausible mechanism | suggests, is consistent with, may |
| Speculation | one possible explanation is … ; this remains to be tested |

Correlation, a single group or a single baseline rarely confirms a causal mechanism. Avoid "proves", "guarantees", "always", "completely".

## Unfavourable results

Report counterexamples, failure conditions and negative or non-significant results. An anomaly can come from the method, the data, the measurement or chance; name a cause only with evidence. Do not explain an anomaly away as noise or user error without support.

## Where boundaries go

Keep the distinction between what was observed and what explains it — that is good writing, not hedging — but place each boundary once (see `paper-layer.md`):

- **At the result it limits.** "Removing [component] lowered [metric] from [a] to [b] (Table 3). The aggregate scores cannot show why; comparing the paired intermediate outputs would test whether [mechanism] is responsible."
- **Measured vs claimed function.** A better score with a component enabled is not a measurement of that component's own reliability (its error-detection rate, false-acceptance rate). Say so once where the ablation is discussed, if the paper's claims depend on it.
- **One Limitations paragraph** in the Discussion collects the study-level limits (data, conditions, attribution across configurations, untested settings). Do not repeat them in every paragraph.
- **Provenance gaps** (which configuration produced a table row) are markers in the setup or table where the fact is needed; the explanation goes to the memo, not into the discussion text.

## Sentence patterns

- "As shown in Fig. 3a, [quantity] decreased from [a] to [b] when [condition], whereas [baseline] remained [c]."
- "This difference is consistent with [mechanism] [ref]; however, [alternative] cannot be excluded because [reason]."
- "These results indicate that [supported finding] under [conditions]. Whether it holds for [untested condition] requires [specific experiment]."

## Output and self-check

Deliver English Results/Discussion that detail the findings the contribution depends on. Working from author-supplied summaries only? Say so in the memo (待核验事项: "依据作者提供的汇总结果，未复算原始统计") — never in the paper text.

Check: every conclusion traces to a result or a citation; every cited figure/table exists; unfavourable results are present; no speculation upgraded to cause or generality; future work is not written as done; each limitation appears once at its claim and once in the Limitations paragraph, not in every paragraph.
