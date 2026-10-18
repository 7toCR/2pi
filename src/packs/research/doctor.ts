import { ENV_PREFIX } from "../../core/config.ts";
import { type DoctorCheck, type DoctorOptions, networkFix, offline, type ProbeResult, probe } from "../../core/doctor.ts";
import { serviceKey } from "../../core/services.ts";
import { openAlexParams } from "./literature.ts";
import { opsConfigured, opsToken } from "./patents.ts";

/**
 * /doctor for the research services: one fixed request each (a generic word or a long-published
 * identifier, never the project's words), so that a missing key, a refused key, a spent quota or a
 * blocked network is found before a search fails.
 */

const LIT = "文献检索";
const PAT = "专利检索";

type Verdict = Omit<DoctorCheck, "group" | "name">;

async function service(name: string, host: string, url: string, options: DoctorOptions, judge: (r: ProbeResult) => Verdict): Promise<DoctorCheck> {
	try {
		return { group: LIT, name, ...judge(await probe(url, options)) };
	} catch (error) {
		return { group: LIT, name, status: "fail", ...networkFix(host, error) };
	}
}

const unexpected = (r: ProbeResult): Verdict => ({ status: "fail", detail: `服务返回 HTTP ${r.status}`, fix: "稍后再试；持续失败时运行 /doctor 并把结果发给维护者" });

export async function researchChecks(options: DoctorOptions = {}): Promise<DoctorCheck[]> {
	if (offline()) {
		return [{ group: LIT, name: "检索服务", status: "skip", detail: `设置了 ${ENV_PREFIX}OFFLINE，没有检测联网服务` }];
	}
	const keyed = !!serviceKey("OPENALEX_KEY");
	const checks = await Promise.all([
		service(
			"OpenAlex",
			"api.openalex.org",
			`https://api.openalex.org/works?${openAlexParams({ search: "transformer", "per-page": "1", select: "id" })}`,
			options,
			(r) =>
				r.status === 200
					? keyed
						? { status: "ok", detail: "正常，使用已配置的 API key" }
						: { status: "ok", detail: "正常（未配置 key，免费额度约每天 100 次检索）", fix: "检索量大时在 /setup 填写 OpenAlex key" }
					: r.status === 401 || r.status === 403
						? {
								status: "fail",
								detail: `API key 被拒绝（HTTP ${r.status}）`,
								fix: "在 /setup 重新填写 OpenAlex key，或清除它改用免费额度",
								credentialsRejected: true,
							}
						: r.status === 429
							? { status: "warn", detail: "今天的免费额度已用完（HTTP 429），检索会改用 Crossref", fix: "在 /setup 填写 OpenAlex key" }
							: unexpected(r),
		),
		service("arXiv", "export.arxiv.org", "https://export.arxiv.org/api/query?id_list=1706.03762&max_results=1", options, (r) =>
			r.status === 200 && /<entry>/.test(r.text)
				? { status: "ok", detail: "正常" }
				: r.status === 200
					? { status: "warn", detail: "能连上，但测试请求没有返回记录", fix: "稍后再试" }
					: unexpected(r),
		),
		service("Crossref", "api.crossref.org", "https://api.crossref.org/works?rows=1&query.bibliographic=transformer", options, (r) =>
			r.status === 200 ? { status: "ok", detail: "正常" } : unexpected(r),
		),
		service("DataCite", "api.datacite.org", "https://api.datacite.org/dois/10.48550%2Farxiv.1706.03762", options, (r) =>
			r.status === 200 ? { status: "ok", detail: "正常（bib_lookup 用它核对 arXiv 等 DataCite DOI）" } : unexpected(r),
		),
	]);
	if (!opsConfigured()) {
		checks.push({
			group: PAT,
			name: "EPO OPS",
			status: "skip",
			detail: "未配置（可选）：专利检索会给出 Google Patents / Espacenet 链接，导出 CSV 后用 patent_import 导入",
			fix: "要直接检索专利，在 /setup 填写 EPO OPS 账号",
		});
	} else {
		try {
			await opsToken(options.signal);
			checks.push({ group: PAT, name: "EPO OPS", status: "ok", detail: "账号有效" });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			checks.push(
				/refused the credentials/.test(message)
					? { group: PAT, name: "EPO OPS", status: "fail", detail: message, fix: "在 /setup 重新填写 EPO OPS 的 key 和 secret", credentialsRejected: true }
					: { group: PAT, name: "EPO OPS", status: "fail", ...networkFix("ops.epo.org", error) },
			);
		}
	}
	return checks;
}
