# The Paper Layer and the Author Memo

Read this for every drafting or revision task. It decides **where** each sentence goes and **how much** space boundaries get. The evidence rules decide what may be said; this file decides where it is said.

Failure this prevents: a draft that is careful about evidence but reads like an audit log — the method section keeps stopping to say which configuration "could not be confirmed", the related work lists what the paper does *not* claim, the abstract spends half its length on caveats, and the conclusion ends with a to-do list for checking provenance. Every individual sentence may be true; the paper still loses its storyline.

## Two layers

Every delivery has two layers:

1. **The paper** (English by default): the authors' account of their research, written in their voice, as it would appear in the journal.
2. **The author memo** (Chinese notes: 主要修改 / 材料缺口 / 待核验事项): everything the authors need to know about the draft, the material and the checks.

The test for any sentence: *would it still make sense in the published paper, read by someone who never saw the materials or this conversation?* If not, it belongs in the memo.

| Content | Paper | Memo |
|---|---|---|
| Method, results, interpretation, contribution | ✓ | |
| A research limit that changes how a result should be read (one dataset, no significance test, different backends across conditions) | ✓ once, next to the claim; again in the Limitations paragraph | |
| A technical clarification that prevents a likely misreading of the paper's own wording | ✓ | |
| What you could or could not verify (references not checked, raw data not recomputed, images not opened) | | ✓ 待核验事项 |
| How the draft was produced (writing trial, prompts used, which material version, repository or work-tree inspection, differences between code and design notes) | | ✓ |
| Provenance gaps (which configuration produced which table row) | marker only where the sentence needs the fact | ✓ explanation |
| Conflicting values between sources | marker | ✓ both values and sources |
| Requests to the authors, follow-up checks, verification to-dos | | ✓ |

**Voice.** The paper speaks as the authors. A fact supported by the authors' material is written plainly ("We sampled at 10 kHz"), not as "according to the supplied records". Whether *you* verified it is memo information. Never write in the paper: "this draft", "this writing trial", "the supplied/provided materials", "author-supplied", "could not be confirmed from the records/repository", "was not recomputed here", "the work tree shows". The checker flags these (W06).

**Material audits are input, not narrative.** When the authors give you code, logs, prompt files or a repository, use them to build the evidence sheet and to describe the method precisely. Discrepancies you find (the code and the design notes disagree; a log does not show which backend ran) go to the memo, with a short marker in the paper only where a sentence cannot be written without the fact.

## Boundary budget

Necessary qualifications are never deleted to make a paper look stronger. They are placed once, where they do their work.

- **At the claim.** State a limit next to the result it limits, once. Do not restate it in every later paragraph.
- **One Limitations paragraph** (or subsection) in the Discussion gathers the limits that matter for the whole study.
- **Abstract:** at most one sentence (better: one clause) of scope or main limitation. The rest is problem, method, key results with conditions, contribution. Checker W07.
- **Introduction and related work:** state positively what the paper does and on what evidence. A "we do not claim …" sentence is used only when readers would otherwise reasonably infer the stronger claim — and never two in a row. Rewrite negatives as a scoped positive:
  - instead of "We do not claim that existing trackers ignore temporal context, and we do not treat ensembling itself as a new gap",
  - write "Our focus is how temporal context is passed from the detector to the tracker."
- **Don't introduce a concept just to deny it** ("these scores are not calibrated probabilities") unless the paper's own wording invites that misreading.
- **Conclusion:** return to the main line — the core objects of the paper and what the evidence showed. Limitations and future work take at most two sentences. Provenance and verification to-dos go to the memo. Checker W07.
- **Strength still follows evidence.** The budget is about placement and repetition, not about upgrading claims. "Suggests" stays "suggests".

## Gap markers

- A marker names the missing item and nothing else, in about 12 words or fewer: `[MISSING: generator backend used for Table 2, rows 3–4]`. Why it is missing, what you searched, and which values conflict go to the memo. Checker G06 flags long markers.
- Put the marker where the fact belongs. If a whole paragraph would be markers, write one plain sentence describing what the paragraph will report, add one marker, and describe the needed material in the memo.
- Markers are for working drafts. Before submission every marker must be resolved; the memo says which ones block submission.

## Closing gaps

A draft full of markers is honest but unfinished. Close gaps with real information — never by deleting the marker, never by writing a vaguer sentence that hides the missing fact.

1. **Search before marking.** Look for the fact in every supplied file — configs, logs, scripts, READMEs, result tables, supplementary notes — before writing a marker. Record in the memo where you looked, so the authors do not search the same places again.
2. **Ask once, early.** For a full draft meant for submission, collect the missing essentials (dataset sizes and splits, checkpoints, seeds, preprocessing, evaluation and listening-test or user-study protocol, hardware) into one batched question at intake when the user is present. Keep drafting with markers meanwhile; do not block on the answer.
3. **Place markers so filling is mechanical.** Put each marker exactly where its value goes, so the sentence reads correctly once filled: "We trained for [MISSING: number of training epochs] epochs." Gather many reproducibility gaps into one configuration table or one setup sentence instead of scattering them through the method text.
4. **Prioritise the memo list.** Under 材料缺口 split the items into 投稿前必须补齐 (a claim, a number or reproducibility depends on it) and 建议补齐 (useful detail). Each line quotes the marker, says what to provide, and where it might be found.
5. **Fill pass.** When the authors supply values: export the markers (`check_paper_draft.py draft.md --export-gaps gaps.json`), have the values entered, replace them with `scripts/fill_gaps.py draft.md gaps.json` (exact replacement, filled items removed from the memo list, remaining markers reported), adjust any sentence that depends on a new value (Abstract numbers, captions, the Limitations paragraph), and run `check_paper_draft.py --final`, which turns every remaining marker into an ERROR.

## Keep what explains

Explanatory sentences are not disclaimers. Keep, and actively write:

- **Design rationale chains:** "[component] gives [consumers] a shared [object], so that [they] do not each build an incompatible [interpretation], which reduces [conflict/error]."
- **Observation vs mechanism:** "The scores show that removing [component] lowers [metric]; they cannot show why. Comparing the paired intermediate records would test whether [mechanism] is responsible." Write this once, at the result.
- **Measured vs claimed function:** "A higher score with the checker enabled does not by itself measure how often the checker accepts faulty output; that rate was not measured." Once, at the result, and in Limitations if central.

## Revising an author's own draft

When the authors provide their own draft, it is the base. Revise it; do not replace it with a new draft built from the materials. Keep their structure, terminology and voice; bring in better material (a sharper opening, a missing rationale, a needed qualification) at the specific places that need it, and list each change under 主要修改.
