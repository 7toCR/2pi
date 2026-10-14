/** Synthetic Crossref data for bibliography tests (no network). */
import type { CrossrefWork, FetchLike } from "../../src/packs/paper/bib.ts";

export const BIB = `% synthetic entries only
@article{doe2020,
  author = {Doe, Ann and Roe, Rick},
  title = {A {Synthetic} Study of Sliding-Window Denoising},
  journal = "Journal of Synthetic Signals",
  year = 2020,
  doi = {https://doi.org/10.0000/SYNTHETIC.1}
}
@article{roe2019, author = {Rick Roe}, title = {Global Thresholding for Synthetic Signals}, year = {2019}, doi = {10.0000/synthetic.2}}
@inproceedings{lee2021, author = {Lee, Kim}, title = {Unregistered Synthetic Work}, year = {2021}, doi = {10.0000/missing}}
@misc{nodoi2022, author = {Poe, Pat}, title = {Wavelet Denoising of Synthetic Vibration Data}, year = {2022}}
@misc{broken2023, title = {Network Failure Example}, doi = {10.0000/fail}}
`;

export const WORKS: Record<string, CrossrefWork> = {
	"10.0000/synthetic.1": {
		DOI: "10.0000/synthetic.1",
		title: ["A synthetic study of sliding-window denoising"],
		author: [{ family: "Doe", given: "Ann" }],
		issued: { "date-parts": [[2021, 1]] },
		"published-online": { "date-parts": [[2020, 12, 3]] },
	},
	"10.0000/synthetic.2": {
		DOI: "10.0000/synthetic.2",
		title: ["Global thresholding for synthetic signals"],
		author: [{ family: "Roe", given: "Rick" }],
		issued: { "date-parts": [[2015]] },
	},
};

export const mockFetch: FetchLike = async (url) => {
	const json = (body: unknown) => ({ status: 200, ok: true, json: async () => body });
	if (url.includes("/works/")) {
		const doi = decodeURIComponent(url.split("/works/")[1] ?? "");
		if (doi === "10.0000/fail") throw new Error("connect ETIMEDOUT");
		const work = WORKS[doi];
		return work ? json({ message: work }) : { status: 404, ok: false, json: async () => ({}) };
	}
	return json({
		message: {
			items: [
				{ DOI: "10.0000/synthetic.3", title: ["Wavelet denoising of synthetic vibration data"], author: [{ family: "Poe" }], issued: { "date-parts": [[2022]] } },
				{ DOI: "10.0000/synthetic.4", title: ["Unrelated synthetic topic"], issued: { "date-parts": [[2010]] } },
			],
		},
	});
};

