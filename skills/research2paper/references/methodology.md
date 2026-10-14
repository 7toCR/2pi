# Methods: how the results were obtained

Purpose (DR_CAN, part III): explain to the reader how the results were obtained. Implicit condition: with the same resources, a reader can follow the path and reproduce the derivations, simulations or experiments. Methods are usually the first section to draft — easy to fill with facts, hard only where the contribution lies.

## Organise by research type

- **Theoretical:** problem definition, assumptions, notation, model, derivation and conditions of validity. An unfinished proof is not a proven theorem.
- **Empirical:** subjects or data sources, inclusion/exclusion criteria, measurement, processing and analysis. Report sample sizes and statistics as given.
- **Engineering / algorithmic / system:** task definition (inputs, outputs, the objects passed between stages), system or algorithm steps, implementation, training or operating settings, baselines and evaluation protocol. Separate method design from experimental setup.

A short task-definition paragraph first (what goes in, what comes out, the named intermediate objects), then the components, is usually the clearest order.

## The method is the authors' designed procedure

Describe the method from the authors' design documents, code, prompts and notes, in their voice. Questions about *which* configuration produced *which* experimental result belong to the experimental setup (with a short marker where a fact is missing) and to the memo — not as hedges spread through the method description. Do not interrupt a component's description to report what you could not confirm in the materials (see `paper-layer.md`).

If the code and the design notes disagree, describe the version the authors identify as their method; if they have not said, use a marker at the affected detail and explain the discrepancy in the memo.

## Purpose before procedure

For each component, write in this order:

1. **Purpose** — which problem it solves, why it is needed (the design rationale).
2. **Input** — the named objects it receives.
3. **Operation** — what it does, including the decision rule.
4. **Output** — the named object it produces and who consumes it.
5. **Failure handling** — checks, revisions, retries, stopping rules.
6. **Parameters** — values, with the authors' reason when they give one.

Low-level operating rules come after the rationale they serve — or out of the component paragraph altogether (see the triage below). A run of specific rules with no stated purpose reads like a manual; the checker flags such paragraphs (M01, INFO).

## Detail triage: core, convention, setting

Before writing a component, sort each rule and value into one of three classes:

| Class | Test | Where it goes |
|---|---|---|
| **Core method** | The reader needs it to understand how the component works, or the contribution claim would change if it changed | Component paragraph, after the purpose, with the authors' reason |
| **Implementation convention** | Needed to reimplement exactly, but changing it would not change the idea: offsets, fallbacks, character or token limits, minimum counts, formatting rules | One "Implementation details" paragraph or subsection, a table, or the appendix/supplement — compressed |
| **Experimental setting** | A value used in a specific experiment: sample counts, seeds, checkpoints, hardware, run counts | Experimental setup or a configuration table |

- **Relocate, never delete.** Every convention stays somewhere in the paper or supplement; list the moves under 主要修改.
- **Don't invent reasons.** Keep the authors' reason with a core rule. A convention in the implementation-details paragraph needs no justification; ask in the memo only when a reviewer would likely question it.
- **Spend the space saved on design.** The component paragraph explains why the design is shaped this way; that is what reviewers judge.
- Checker M02 flags Methods paragraphs dominated by convention-type rules outside an implementation-details section.

## Decisions made by models

If a component decides by prompting a model with criteria rather than by a formal rule, say so plainly and specify what it receives, which criteria it applies and which outcomes are possible (accept, return to a named stage, stop). Do not present such a procedure as a formal algorithm, and do not leave it as an unexplained symbol either.

## System and architecture papers

The reader should be able to redraw the system from the text alone:

- Name every object passed between components (representation, plan, record, fields) and say who produces and who consumes it.
- For shared representations, state what they make consistent across consumers, and what goes wrong without them.
- For check-and-revise loops, state what is checked (structure vs meaning), what triggers revision, which upstream outputs are re-checked after a change, and the stopping rule.
- The overview figure and the text use the same names for the same objects (see `figures-tables.md`).

## Reproducibility details

Check, as the study requires: data splits, preprocessing, key parameters, equipment and models, software and versions, number of repetitions, randomness (seeds), metric definitions and statistical methods. Anything not supplied becomes a short marker such as `[MISSING: random seed and number of runs]`. Never infer the author's choices from "common practice" or software defaults.

Separate what is adopted from prior work (cite it, describe briefly) from what this paper contributes (describe fully). Give the space to details that affect the results or the contribution claim.

## Symbols and equations

- Define every symbol, subscript and unit at first use; spell out every abbreviation at first use. For symbol-heavy papers build a Nomenclature table (symbol, unit, meaning) at the start of writing, as the notes recommend.
- One object, one symbol, one name, one unit throughout; one symbol never silently means two quantities. Use subscripts where confusion is likely.
- Write equations in LaTeX; number displayed equations that are referred to and refer to them by number ("Substituting Eq. (3) into Eq. (5) gives …"). Keep existing labels; if a renumbering is unavoidable, update every reference.
- An equation must add something the prose does not. A line such as $Y = \mathcal{M}(X_1, X_2 \mid S)$ only names a step; follow it with the decision rule of $\mathcal{M}$, or present it as notation and explain the mechanism in words. Do not let a compact formula stand in for an unexplained mechanism.
- If you find a symbol clash, a dimensional inconsistency or a missing derivation step, point to its location in the memo. Do not "fix" it into a plausible-looking formula without evidence.

Symbol and equation errors affect acceptance: reviewers check derivations, and inconsistent notation makes a paper unreadable.

## No padding

Cut content the results do not use (DR_CAN's test: is the equation used later in a derivation or experiment?). Unrelated background moves to the Introduction or out; textbook material (e.g. F = ma) is cited, not derived. Save the space for Results and Discussion.

## Tense and status

Completed work: past tense. Planned work: future or conditional tense, clearly labelled. Never present a planned step as performed.

## Self-check

Could another researcher redraw the pipeline and follow the described path? Does each component say why it exists before how it works? Is every described step part of the authors' documented method (plans labelled as plans)? Does every metric, dataset or condition used in Results have its origin here? Is every verification remark in the memo rather than the text, and does every marker have a line there?
