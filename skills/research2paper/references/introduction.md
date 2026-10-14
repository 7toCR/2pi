# Introduction: from importance to the gap

The Introduction is the reader's first contact with the work. It answers two questions (DR_CAN, part I):

1. **What is the research topic?**
2. **What is the motivation?** (a) why it matters, moving from broad to specific; (b) what is still missing.

The second answer justifies the first and leads the reader into the paper's logic.

## Three moves

1. **Background and importance.** Start from the problem area directly relevant to the study and narrow to the specific object. Figures, trends and phenomena need sources; importance is argued with concrete consequences (cost, safety, accuracy, energy, scale), not adjectives such as "crucial" or "of great significance".
2. **Literature and gap.** Organise prior work by approach, assumption or capability limit — not one paragraph per paper. Show what has been achieved, then the specific problem that remains under the conditions this paper addresses.
3. **This work.** Map the method, the scope of validation and the supported contributions onto the gap. Contributions can be a method, a finding or a validated application; their number follows the argument, not a template. Add a paper-organisation paragraph only if the journal expects it or the user asks.

Write continuous prose. Do not leave "Background / Literature review / Thesis statement" labels in the paper.

If a separate Related Work section exists, keep only the overview needed for motivation in the Introduction and move detailed comparisons there.

## Open with the specific tension

The strongest first paragraph names the concrete problem the paper works on, not a generic statement that the field is important or that data are multimodal. A reliable shape is two linked observations that expose the step the paper studies:

- "[Output] can score well on [usual criterion] and still fail [the requirement that matters here]."
- "Even when [the requirement] is understood, it may not be expressible through [the interface/mechanism that existing systems use]."
- "This paper studies the step in between: how [understanding] is turned into [executable decision]."

Background then supports this tension instead of preceding it for a page. Use the author's facts and citations for each observation; if an observation has no support yet, it is a position to verify, not an opening claim.

## Related work: compare mechanisms, not names

A catalogue ("X [1] generates …. Y [2] uses …. Z [3] proposes ….") tells the reader what exists but not how this paper differs, and leaves them to guess why the design answers the problem. Organise prior work by the paper's own design axes instead:

1. **Choose two to four axes** from the contribution — the questions the design answers. Typical axes for a system paper: what representation is passed between stages; how decisions from several components are coordinated; how errors or conflicts are detected and handled; which input conditions are supported.
2. **Fill a grid internally**: rows are the closest works, columns are the axes, each cell is what that work actually does on that axis, with its citation. The source is the cited paper or the authors' description of it. Unknown cells stay empty.
3. **Write by axis**, not by paper: what prior work does on this axis (grouped where works agree), then what this paper does, in parallel factual form — "[X] [3] conditions generation directly on [A], and [Y] [4] adds [B] before generation; our pipeline instead passes [C] between [stages] so that [effect]."
4. **Contrast with mechanism facts, not adjectives.** "Explicit", "shared", "unified", "compatible", "coherent" are not differences by themselves. Say what is shared, between which components, and what it prevents.
5. **Link each design choice to the limitation it answers**: "Because [what approach X does] leads to [problem] when [condition], we [design choice], so that [consequence]."

**Grounding (not over-claiming).** Describe what a prior work does, not what it lacks. "X lacks / ignores / cannot handle …" needs evidence from X itself; with only a title or abstract, describe X at that level and add a memo item to verify. A work whose cell is unknown is left out of that axis rather than guessed. For full drafts, put the grid in the memo so the authors can check each cell quickly.

**No extra hedging (not over-conservative).** The parallel form "X does A; we do B" is a factual contrast and needs no disclaimer. Do not add "we do not claim that X lacks B" — the parallel form already avoids that claim.

## Revising keeps information

When improving an existing sentence — the authors' or an earlier draft's — the new sentence keeps every specific fact of the old one: what a method does, on which input, by which mechanism. Smoother but vaguer is worse. A description that restates a method's name as its function ("the Temporal Event Parser parses temporal events") carries no information; replace it with what the method does differently ("segments clips into events at optical-flow peaks [2]"). Checker W08 flags name-restating descriptions; W09 flags related-work paragraphs that list methods without any comparison.

## Position positively, close with contributions

- State what the paper does and on what evidence. Reserve "we do not claim …" for a reader's likely misreading, at most once; never a run of negative positioning sentences (see `paper-layer.md`, checker W07).
- Close the Introduction with the contributions: two to four items, each naming a concrete object (a representation, a procedure, a finding), what it does, and where it is evaluated ("Section 4.3"). A reader should be able to remember the paper by these names.

## Evidence rules for the gap

- State each gap with its scope ("for multi-rate sensor fusion under packet loss", not "in general").
- "No one has studied X" cannot be inferred from the author not supplying such papers. Strong claims ("first", "no prior work", "fills the gap", "leading") need a documented search and comparison; otherwise rewrite them as a scoped, specific problem statement.
- A title or abstract supports only what it actually says. Keep each citation attached to the statement it supports; ask for full text (in the memo) when the support is unclear.
- Recent work shows the current state; foundational older work is not removed for being old. Cite as many sources as the argument needs.
- Importance, advantages and contributions must not exceed what the experiments or theory support. Which references you could not verify is memo information, not Introduction text.

## Useful sentence patterns

Placeholders only — fill with the author's facts, never with invented ones.

- Tension: "[Output] may meet [criterion] yet fail [requirement]; and [understanding] may not translate into [actionable condition]."
- Narrowing: "Among these applications, [specific object] is particularly demanding because [verified reason] [ref]."
- Prior work by approach: "One line of work addresses [problem] by [approach] [refs]; these methods assume [assumption], which [specific limitation] when [condition]."
- Gap: "However, [specific problem] under [condition] remains [unresolved / unquantified], because [reason supported by refs]."
- Design link: "To address this, we [design choice], which [mechanism] and thus [effect]."
- This work: "In this paper, we [method] to [address the gap]. We evaluate it on [data/setting] and show that [supported result]."
- Contributions: one sentence each, each traceable to a section and a result.

## Rules of thumb (adjust to field and journal)

From the DR_CAN notes: cite recent work (≈ last five years), choose references that build the argument, consider a conceptual figure or table, and keep the Introduction around 10 % of the paper. These are defaults; the journal and the field decide.

## Self-check

A reader of the Introduction alone can say: what the problem is, how the closest works handle each design axis and how this paper differs (in mechanism, not adjectives), why each part of the design answers that shortfall, what this paper contributes and where each contribution is evaluated. If the gap still lacks literature, keep the marker and flag it in the memo. No conclusions or numbers appear that the Results do not deliver.
