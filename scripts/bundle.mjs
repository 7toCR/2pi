#!/usr/bin/env node
// Bundle 2pi into dist/bundle/cli.js. Unbundled, a global install resolves ~1,700 module files at
// startup, which dominates launch time on Windows. pi ships its own CLI pre-bundled, so the bundle
// loads that copy of pi at runtime (as pi does for its extensions) and inlines everything else.
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "dist", "bundle", "cli.js");
const PI = "@earendil-works/pi-coding-agent";

// The export names of pi's bundled library entry, so 2pi's imports from pi bind to that copy.
// esbuild fails the build if 2pi imports a name the bundled entry does not export.
const piBundle = new URL("./bundle/index.js", import.meta.resolve(PI));
const piExports = Object.keys(await import(piBundle.href)).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));

const piHost = {
	name: "pi-host",
	setup(build) {
		build.onResolve({ filter: new RegExp(`^${PI}$`) }, () => ({ path: PI, namespace: "pi-host" }));
		build.onLoad({ filter: /.*/, namespace: "pi-host" }, () => ({
			loader: "js",
			contents: [
				`import { existsSync } from "node:fs";`,
				`import { fileURLToPath } from "node:url";`,
				`const entry = import.meta.resolve(${JSON.stringify(PI)});`,
				`const bundled = new URL("./bundle/index.js", entry);`,
				`const pi = await import(existsSync(fileURLToPath(bundled)) ? bundled.href : entry);`,
				`export const { ${piExports.join(", ")} } = pi;`,
			].join("\n"),
		}));
	},
};

const result = await build({
	entryPoints: [join(root, "src", "cli.ts")],
	outfile,
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	plugins: [piHost],
	// CommonJS dependencies call require(); give the ES module bundle one.
	banner: {
		js: `import { createRequire as __twopiCreateRequire } from "node:module"; const require = __twopiCreateRequire(import.meta.url);`,
	},
	legalComments: "none",
	metafile: true,
	logLevel: "warning",
});
const { bytes } = Object.values(result.metafile.outputs)[0];
console.error(`Bundled ${relative(root, outfile)} (${Math.round(bytes / 1024)} KB, ${Object.keys(result.metafile.inputs).length} modules).`);
