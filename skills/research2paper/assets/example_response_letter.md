<!--
Synthetic example for research2paper: a working-draft response letter for the example manuscript.
Reviewer comments, changes and locations are invented to demonstrate the format and to smoke-test
scripts/check_paper_draft.py --mode response. Comment 2 shows how an unfinished experiment is handled.
-->

# Response to Reviewers

We thank the editor and the reviewers for their comments. Each comment is answered below; changes in the revised manuscript are highlighted in yellow.

## Reviewer 1

**Reviewer 1, Comment 1**

**Comment:** The Introduction does not explain why a fixed median-filter window is a problem. Please clarify the motivation.

**Response:** We agree that the motivation was stated too briefly. We have revised the second paragraph of the Introduction to explain the trade-off of a fixed window: short windows leave impulsive noise in low-SNR recordings, whereas long windows smear fault impacts in clean recordings. The paragraph now also states that existing pipelines choose one window for the whole data set, which is the specific gap this study addresses.

**Changes in the manuscript:** Section 1, paragraph 2 was rewritten as described above, with citations [3] and [4].

**Location:** Section 1, paragraph beginning "The difficulty is noise."

**Reviewer 1, Comment 2**

**Comment:** The accuracy gain may be due to chance. Please report a statistical test for the paired results.

**Response:** We agree that a paired test is needed before the difference can be interpreted as more than an observed gain, and the manuscript currently makes no significance claim. The appropriate test for paired correct/incorrect outcomes is McNemar's test. [MISSING: McNemar test result for the paired detection outcomes in the low-SNR group]

**Changes in the manuscript:** [MISSING: completed analysis and manuscript changes]

**Location:** [MISSING: manuscript location]

## 材料缺口

- `[MISSING: McNemar test result for the paired detection outcomes in the low-SNR group]`：需要逐条检测结果（每条记录两种方法是否判对）才能计算；检验完成前，本条只能作为工作草稿。
- `[MISSING: completed analysis and manuscript changes]`：检验完成后，在第 3 节补充检验结果，并据结果调整第 4 节的表述。
- `[MISSING: manuscript location]`：修改完成后填写实际位置。

这是工作草稿，需完成所列修改后才能用于返修提交。
