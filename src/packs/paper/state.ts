import { normalizePath } from "../../core/paths.ts";

export interface CheckSummary {
	path: string;
	errors: number;
	warnings: number;
	final: boolean;
	at: string;
}

export interface CompileSummary {
	main: string;
	ok: boolean;
	/** Errors plus undefined references/citations, missing files and duplicate labels. */
	problems: number;
	pages?: number;
	at: string;
}

/** Session state of the paper pack. Paths are absolute as given; sets key on normalized paths. */
export class PaperState {
	lastCheck: CheckSummary | undefined;
	lastCompile: CompileSummary | undefined;
	/** Manuscript-like files written or edited since they were last checked. */
	readonly unchecked = new Map<string, string>();
	/** LaTeX projects (folder of the main .tex) with source changes since the last compile. */
	readonly uncompiled = new Map<string, string>();

	markUnchecked(path: string): void {
		this.unchecked.set(normalizePath(path), path);
	}

	markChecked(path: string): void {
		this.unchecked.delete(normalizePath(path));
	}

	markUncompiled(project: string): void {
		this.uncompiled.set(normalizePath(project), project);
	}

	markCompiled(project: string): void {
		this.uncompiled.delete(normalizePath(project));
	}
}

const MANUSCRIPT_EXT = /\.(?:md|tex|bib|txt)$/i;
/** Files whose change makes the PDF stale. */
export const LATEX_SOURCE_EXT = /\.(?:tex|bib|sty|cls|bst|png|jpe?g|pdf|eps|svg)$/i;

/** Files the checker should see after they change: drafts, letters, bibliographies. */
export function isManuscriptFile(path: string): boolean {
	return MANUSCRIPT_EXT.test(path);
}
