import { existsSync } from "node:fs";
import { type EvidenceEntry, loadLedger } from "../../core/evidence.ts";

/**
 * Trace the numbers of a patent draft to the project's evidence ledger, with the rule the paper
 * checker uses for V01: a salient number is traced when a ledger value equals it at the precision
 * it is written with; entries classed missing never count. Advisory only: a patent's fidelity is
 * mostly in its technical features, which numbers cannot show.
 */

/** Units that make a number a measurement or count in Chinese patent text. */
const UNIT =
	/^\s*(?:%|％|个百分点|百分点|个|次|条|帧|项|组|层|维|倍|位|比特|样本|采样点|像素|秒|毫秒|微秒|分钟|小时|天|赫兹|千赫兹|兆赫兹|摄氏度|℃|°C|度|毫米|厘米|米|千克|克|字节|万|千|亿|dB|Hz|kHz|MHz|GHz|ms|us|μs|s(?![A-Za-z])|mm|cm|nm|m(?![A-Za-z])|kg|g(?![A-Za-z])|KB|MB|GB|TB|bit|bits|fps|epochs?|samples?|px)/;
const NUMBER = /(?<![\w.\-[])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s*[%％])?/g;
const CJK = /[㐀-鿿]/;

/**
 * Numbers in patent text that state a value: with a decimal point, a percent sign, or (for
 * integers of at least 10) a unit right after. Reference numerals ("模块301"), step labels
 * ("S101"), years, figure and claim numbers, and placeholders 【待补充：…】 are skipped.
 */
export function salientPatentNumbers(text: string): string[] {
	const cleaned = text.replace(/【[^】]*】/g, " ").replace(/\[[^\]]*\]/g, " ");
	const out: string[] = [];
	for (const match of cleaned.matchAll(NUMBER)) {
		const token = match[1] ?? "";
		const percent = !!match[2];
		const value = token.replace(/,/g, "");
		const before = cleaned[(match.index ?? 0) - 1] ?? "";
		const after = cleaned.slice((match.index ?? 0) + match[0].length);
		const hasUnit = percent || UNIT.test(after);
		if (/^(?:19|20)\d{2}$/.test(value) && !percent) continue;
		// After a Chinese character without a unit, a number labels something (图12, 模块301).
		if (CJK.test(before) && !hasUnit) continue;
		if (value.includes(".") || percent || (Number(value) >= 10 && hasUnit)) out.push(token);
	}
	return out;
}

export function ledgerValues(entries: EvidenceEntry[]): number[] {
	const values: number[] = [];
	for (const entry of entries) {
		if (/^(missing|conflicting)/i.test(String(entry.class))) continue;
		for (const token of entry.numbers ?? []) {
			const value = Number(String(token).replace(/,/g, ""));
			if (Number.isFinite(value)) values.push(value);
		}
	}
	return values;
}

export function traced(token: string, values: number[]): boolean {
	const t = Number(token.replace(/,/g, ""));
	const decimals = token.includes(".") ? (token.split(".")[1] ?? "").length : 0;
	const round = (v: number) => Number(v.toFixed(decimals));
	return values.some((v) => Math.abs(v - t) < 1e-9 || Math.abs(round(v) - t) < 1e-9);
}

/** Every string in the application text: abstract, claims, description. Notes and maps are not text. */
function applicationText(data: Record<string, unknown>): Array<{ where: string; text: string }> {
	const out: Array<{ where: string; text: string }> = [];
	const walk = (value: unknown, where: string) => {
		if (typeof value === "string") out.push({ where, text: value });
		else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${where}[${i + 1}]`));
		else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) walk(item, `${where}.${key}`);
	};
	walk(data.abstract, "abstract");
	walk(data.claims, "claims");
	walk(data.description, "description");
	return out;
}

export interface LedgerTrace {
	entries: number;
	untraced: Array<{ token: string; where: string }>;
}

/** Undefined when the project has no ledger. */
export function traceAgainstLedger(data: Record<string, unknown>, ledgerFile: string): LedgerTrace | undefined {
	if (!existsSync(ledgerFile)) return undefined;
	const ledger = loadLedger(ledgerFile);
	const values = ledgerValues(ledger.entries);
	const seen = new Map<string, string>();
	for (const { where, text } of applicationText(data)) {
		for (const token of salientPatentNumbers(text)) if (!traced(token, values) && !seen.has(token)) seen.set(token, where);
	}
	return { entries: ledger.entries.length, untraced: [...seen].map(([token, where]) => ({ token, where })) };
}

export function formatTrace(trace: LedgerTrace): string {
	if (trace.untraced.length === 0) return `账本对账：申请文本中的数值都能在证据账本（${trace.entries} 条）中找到出处。`;
	return [
		`账本对账（提示，不阻断）：以下 ${trace.untraced.length} 个数值在证据账本中找不到出处——`,
		...trace.untraced.slice(0, 30).map((item) => `- '${item.token}'（${item.where}）`),
		"能在材料中找到出处的，先用 evidence 记账；找不到的改为【待补充：…】。附图标记、步骤号不在核对范围内。",
	].join("\n");
}
