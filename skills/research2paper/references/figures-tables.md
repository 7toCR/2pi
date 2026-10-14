# Figures and Tables

Figures and tables are what reviewers look at first and what forms the first impression (DR_CAN, part V). Fix their problems before a reviewer points them out.

## Purpose first

For each figure or table, name the finding it supports, the real variables and data it uses, and the comparison it shows. Without data, deliver a plan and the list of missing material; never generate example results that could pass as research figures.

Judge fonts, cropping, colours, legends and layout only for images you can actually see. With only captions or descriptions, limit the check to content and cross-references and mark visual quality as unverified.

## Rules

1. **Journal guide first.** Author guidelines and templates decide numbering, "Figure" vs "Fig.", caption position, panel labels, resolution and size. Common defaults (Arabic figure numbers, caption below figures and above tables) are only defaults; the notes' Roman table numbers are one journal family's style, not a rule. Without a guide, use Figure 1 / Table 1 and list the items to confirm.
2. **Every figure and table is cited in the text**, in order of first citation. Conceptual figures in the Introduction are the ones most often left uncited.
3. **Cite by number**: "According to Fig. 7, …", "Table 3 indicates that …". Never "the figure above", "the table on the left".
4. **Consistency.** Names, symbols, units, groups, sample sizes and metric definitions match the text. A symbol italic in the equations is italic in the figure.
5. **Clear, complete captions.** A caption lets the reader understand what is shown, under which conditions, and what the marks mean, without hunting through the text. Long is acceptable. Define n, error bars (SD, SE, 95 % CI) and significance markers only from actual material.
6. **Distinguish series by colour and by line style or marker**, so grayscale printing still works. Do not use clutter, truncated axes or selective display to hide unfavourable results — some of them are worth discussing.
7. **Multi-panel figures** label panels (a), (b), … and the caption describes each label used.
8. **No reuse without disclosure.** Reusing a published figure needs a citation and, where required, permission; altering its appearance is not permission and does not remove duplicate-publication concerns. Keep the raw data behind every figure for reviewer requests.

## System overview figures

For a system or architecture paper, the overview figure is the reader's map of the method:

- Draw components **and** the objects passed between them (shared representation, plan, record), not only a column of stage boxes. A four-box linear flow is enough only for a genuinely linear pipeline.
- Show check-and-revise loops as a decision node with labelled return edges and the stopping condition, so the figure shows the mechanism, not just the success path.
- Use exactly the names used in the Methods text; every node in the figure is described there, and every component in the text appears in the figure.
- Complexity is not the goal: the figure should let a reader redraw the data flow, nothing more. Split a crowded figure into an overview and a detail panel.

## Caption pattern

"Fig. 3. [What is plotted] for [conditions/groups] on [data]. (a) [panel a]; (b) [panel b]. Error bars indicate [SD/SE/CI] over [n] [runs/subjects]. [Abbreviation definitions]."

Leave `[MISSING: …]` for any element the material does not give.

## Output

- **Planning:** for each figure — purpose, data needed, suggested chart type, comparison, where it is cited.
- **Captions:** English captions/table titles, then Chinese notes on changes and gaps.
- **Checking:** per figure/table — issue, location, why it matters, fix; state separately what was checked in text, numbers and visuals.

This skill writes plans, captions and checks. It does not generate plots; if another tool produces images, report rendering checks separately and do not claim submission-ready resolution before it is verified.
