<!-- Test fixture: deliberately flawed synthetic draft. Every defect here is intentional. -->
# A Novel Lightweight Denoiser for Vibration Sensors

## Abstract

We propose a novel method that significantly improves accuracy by 4% over the baseline (80% vs 84%) and reaches 91.3% recall. This proves the method is the best.

## 1. Introduction

Vibration monitoring with low-cost sensors is widely used [1]. Convolutional neural networks (CNN) are popular [2], [5]. SNR is a key metric. As shown in the figure above, noise matters. TODO add more.

## 2. Methods

The input is sampled at 10Hz. We define the signal-to-noise ratio (SNR) in Eq. (1).

$$ \mathrm{SNR} = 10 \log_{10}(P_s/P_n) \tag{1} $$

Substituting Eq. (2) into Eq. (1) gives the result. The window length is [MISSING]. The stride is [MISSING: stride of the sliding window].

## 3. Results

Fig. 2(c) shows the accuracy. Table 2 lists the recall. Fig. 1 shows the setup.

**Figure 1.** Setup of the experiment.

![Figure 2. Accuracy (a) baseline; (b) ours.](fig2.png)

Table 1. Recall per class.

| class | recall |
|---|---|
| A | 91.3 |

Accuracy increased from 80% to 84%. The World Cup example is great.

## 4. Conclusion

We propose a novel method that significantly improves accuracy by 4% over the baseline and reaches 95.0% recall in all tests.

## References

[1] Example Author A, Example study on sensors, Example Journal, 2021.
[2] Example Author B, Another example study.
[3] Example Author C, Unused, 2020.

## 材料缺口

- `[MISSING: something else]`：请提供。
