/**
 * Load 2pi into a stock pi installation instead of the 2pi launcher:
 *   pi -e path/to/agent/src/pi-extension.ts
 */
import { createTwoPiExtension } from "./extension.ts";

export default createTwoPiExtension();
