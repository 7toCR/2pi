<!--
Synthetic example for research2paper. The study, data, numbers and references are invented
to demonstrate the output format and to smoke-test scripts/check_paper_draft.py.
Do not cite or reuse any of it as research content.
-->

# Adaptive Median Filtering for Bearing Fault Detection with Low-Cost Accelerometers

## Abstract

Low-cost micro-electro-mechanical systems (MEMS) accelerometers make continuous bearing monitoring affordable, but their noise floor can mask early fault signatures. This study evaluates an adaptive median filter (AMF) that sets its window length from the estimated noise level before envelope analysis. On a synthetic benchmark of 200 recordings (100 healthy and 100 with outer-race defects), fault-detection accuracy increased from 80.0% with a fixed-window filter to 84.0% with the AMF, an absolute gain of 4.0 percentage points (a relative increase of 5.0%). The gain came entirely from recordings with a signal-to-noise ratio (SNR) below 5 dB. These results indicate that noise-adaptive window selection can improve detection with inexpensive sensors; validation on field data is still required.

## 1. Introduction

Rolling-element bearings are among the most frequent failure points in rotating machinery, and detecting outer-race defects early reduces unplanned downtime [1]. Envelope analysis of vibration signals is the standard way to expose the periodic impacts produced by such defects [2]. Industrial vibration sensors deliver clean signals but are too expensive to install on every small motor, which has motivated the use of low-cost MEMS accelerometers [3].

The difficulty is noise. MEMS accelerometers have a higher noise floor than piezoelectric sensors, and impulsive noise can either mimic or hide fault impacts [3]. Median filtering suppresses impulsive noise while preserving edges, but a fixed window length is a compromise: short windows leave noise in low-SNR recordings, while long windows smear the fault impacts in clean ones [4]. Existing pipelines choose the window once for the whole data set [4], so detection performance depends on how well that single choice matches the noise level of each recording.

In this paper, we select the median-filter window for each recording from a robust estimate of its noise level and evaluate whether this improves envelope-based fault detection. We compare the adaptive filter with a fixed-window baseline on the same synthetic recordings and evaluation protocol. The contribution is limited to this comparison: we quantify the change in detection accuracy and identify the noise conditions in which it occurs.

## 2. Methods

### 2.1 Data

The benchmark contains 200 synthetic recordings of 1 s each, sampled at 10 kHz: 100 healthy recordings and 100 recordings with an outer-race defect. Impulsive and Gaussian noise were added so that 100 recordings had an SNR below 5 dB and 100 had an SNR of at least 5 dB, with healthy and faulty recordings split evenly between the two groups. The sensor characteristics follow a generic MEMS noise model; [MISSING: accelerometer model and noise-density value used to parameterise the noise model].

### 2.2 Adaptive median filter

The processing pipeline is shown in Fig. 1. For each recording $x$, the noise level is estimated with the median absolute deviation of the first-order difference:

$$ \hat{\sigma} = \frac{\operatorname{median}\left(\left|\Delta x - \operatorname{median}(\Delta x)\right|\right)}{0.6745 \sqrt{2}} \tag{1} $$

where $\Delta x$ is the first-order difference of $x$. The window length $L$ (in samples) is then set by

$$ L = \min\left(L_{\max}, \max\left(L_{\min}, 2\left\lceil k \hat{\sigma} / \sigma_{0} \right\rceil + 1\right)\right) \tag{2} $$

where $k$ is a scaling constant, $\sigma_{0}$ is the noise level of a reference clean recording, and $L_{\min} = 3$ and $L_{\max} = 31$ bound the window. Substituting the estimate from Eq. (1) into Eq. (2) yields a window that grows with the noise level and is always odd, so the median is defined by a single sample.

### 2.3 Detection and evaluation

The filtered signal is band-pass filtered, its envelope is computed with the Hilbert transform, and a recording is classified as faulty when the envelope spectrum shows a peak at the outer-race defect frequency that exceeds a threshold fixed on a separate calibration set [2]. The baseline uses the same pipeline with a fixed window of $L = 7$ samples. Both methods are evaluated on the same 200 recordings, and accuracy is the proportion of correctly classified recordings.

**Figure 1.** Processing pipeline. The noise level of each recording sets the median-filter window (Eqs. (1) and (2)); the filtered signal then passes through band-pass filtering, envelope extraction and envelope-spectrum thresholding.

## 3. Results

Table 1 summarises detection accuracy. Over all 200 recordings, accuracy increased from 80.0% (160 of 200) with the fixed window to 84.0% (168 of 200) with the AMF, an absolute gain of 4.0 percentage points, or a relative increase of 5.0%.

Table 1. Fault-detection accuracy by SNR group (100 recordings per group).

| SNR group | Fixed window (L = 7) | AMF |
|---|---|---|
| Below 5 dB | 68.0% | 76.0% |
| 5 dB or above | 92.0% | 92.0% |
| All recordings | 80.0% | 84.0% |

The whole gain came from the low-SNR group, where accuracy rose from 68.0% to 76.0% (Fig. 2a); in the high-SNR group both methods reached 92.0% (Fig. 2b). The change in the low-SNR group was not uniform: the AMF corrected 11 recordings that the fixed window misclassified but introduced 3 new errors, all of them healthy recordings classified as faulty. No statistical test was performed on the paired outcomes; [MISSING: McNemar test result for the paired detection outcomes in the low-SNR group].

**Figure 2.** Detection accuracy of the fixed-window filter and the AMF. (a) Recordings with SNR below 5 dB; (b) recordings with SNR of 5 dB or above. Each bar is the proportion of correctly classified recordings in the group.

## 4. Discussion

The concentration of the gain in low-SNR recordings is consistent with the design of the filter: Eq. (2) widens the window only when the estimated noise is high, and wider windows remove more impulsive noise before envelope extraction. For clean recordings the adaptive window stays close to the fixed one, which explains why accuracy did not change in that group.

The three new false alarms suggest that a wide window can also merge closely spaced noise impulses into a broader pulse that the envelope spectrum mistakes for a fault impact. This explanation has not been tested; inspecting the window lengths and envelope spectra of these recordings would show whether they share a common noise pattern.

The evidence has clear limits. All recordings are synthetic, contain a single defect type and come from one noise model, so the size of the gain on field data is unknown. The 4.0-percentage-point difference has not yet been tested for statistical significance, and the calibration threshold was shared by both methods, which favours neither but may not be optimal for either.

## 5. Conclusion

This study examined whether choosing the median-filter window from each recording's own noise level improves envelope-based bearing fault detection with low-cost accelerometers. On a synthetic benchmark the adaptive filter detected faults more accurately than a fixed window, and the improvement appeared only where noise was strong, at the cost of a few additional false alarms. Noise-adaptive preprocessing is therefore a promising, inexpensive addition to MEMS-based monitoring pipelines, provided that its benefit is confirmed on field recordings, with other defect types and with a paired statistical test.

## References

[1] A. Example and B. Sample, "Placeholder reference on bearing failure statistics," Example Journal of Machinery, vol. 1, pp. 1–10, 2019.

[2] C. Example, "Placeholder reference on envelope analysis for bearing diagnostics," Example Transactions on Signal Processing, vol. 2, pp. 11–20, 2018.

[3] D. Sample and E. Example, "Placeholder reference on low-cost MEMS vibration sensing," Example Sensors Letters, vol. 3, pp. 21–30, 2022.

[4] F. Example, "Placeholder reference on median filtering of vibration signals," Example Journal of Signal Processing, vol. 4, pp. 31–40, 2021.

## 材料缺口

- `[MISSING: accelerometer model and noise-density value used to parameterise the noise model]`：请提供噪声模型所依据的加速度计型号和噪声密度。
- `[MISSING: McNemar test result for the paired detection outcomes in the low-SNR group]`：请提供低信噪比组配对检测结果的 McNemar 检验结果；没有检验时，正文不能写“显著”。

## 待核验事项

- 结果依据作者提供的汇总数，未复算逐条检测结果。
- 参考文献 [1]–[4] 为作者提供的条目，尚未核对全文是否支持对应陈述。
- 尚未取得目标期刊作者指南，摘要长度、图表编号和参考文献格式按通用格式处理。
