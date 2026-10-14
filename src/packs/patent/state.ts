import { normalizePath } from "../../core/paths.ts";

export interface CheckRecord {
	errors: number;
	warnings: number;
}

/** What the patent pack tracks for the finish gate and <project_state>. */
export class PatentState {
	/** Patent JSON files written or edited since their last check (normalized paths). */
	readonly dirtyJson = new Set<string>();
	readonly lastCheck = new Map<string, CheckRecord>();
	/** What the latest build produced that the model should look at: drawings, and the PDFs or their page images. */
	builtImages: { drawings: string[]; previews: string[]; pdfs: string[] } = { drawings: [], previews: [], pdfs: [] };

	markJsonWritten(path: string): void {
		this.dirtyJson.add(normalizePath(path));
	}

	recordCheck(path: string, record: CheckRecord): void {
		const key = normalizePath(path);
		this.dirtyJson.delete(key);
		this.lastCheck.set(key, record);
	}

	recordBuild(drawings: string[], previews: string[], pdfs: string[] = []): void {
		this.builtImages = { drawings, previews, pdfs };
	}
}
