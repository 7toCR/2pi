#!/usr/bin/env node
// From a checkout (or `npm link`), run the TypeScript sources with Node's type stripping.
// Node does not strip types under node_modules, so packed installs run the compiled dist/:
// the single-file bundle when present (far fewer files to resolve at startup), else dist/cli.js.
import { existsSync } from "node:fs";
import { enableCompileCache } from "node:module";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

enableCompileCache();
const packed = fileURLToPath(import.meta.url).includes(`${sep}node_modules${sep}`);
const bundle = new URL("../dist/bundle/cli.js", import.meta.url);
const entry = !packed ? "../src/cli.ts" : existsSync(bundle) ? "../dist/bundle/cli.js" : "../dist/cli.js";
await import(new URL(entry, import.meta.url).href);
