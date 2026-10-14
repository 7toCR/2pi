#!/usr/bin/env node
// From a checkout (or `npm link`), run the TypeScript sources with Node's type stripping.
// Node does not strip types under node_modules, so packed installs run the compiled dist/.
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

const packed = fileURLToPath(import.meta.url).includes(`${sep}node_modules${sep}`);
await import(new URL(packed ? "../dist/cli.js" : "../src/cli.ts", import.meta.url).href);
