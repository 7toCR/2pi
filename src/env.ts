/**
 * Process setup that must run before pi's modules load: pi reads its config directory and
 * version-check settings from the environment.
 */
import { join } from "node:path";
import { AGENT_NAME, env, getAgentHome, PI_VARIABLES } from "./core/config.ts";

// Own config, credentials, and sessions, so the user's pi extensions and skills stay out of 2pi.
// TWOPI_USE_PI_CONFIG=1 shares ~/.pi/agent instead (e.g. to reuse a pi login).
if (!env("USE_PI_CONFIG")) {
	process.env.PI_CODING_AGENT_DIR = env("CODING_AGENT_DIR") ?? env("AGENT_DIR") ?? join(getAgentHome(), "agent");
}
// pi's other process variables under 2pi's names: TWOPI_OFFLINE=1 is PI_OFFLINE=1, and so on.
for (const name of PI_VARIABLES) {
	if (name === "CODING_AGENT_DIR") continue;
	const value = env(name);
	if (value !== undefined) process.env[`PI_${name}`] = value;
}
// The pi.dev update notice would tell users to update pi, which is not how 2pi is updated.
process.env.PI_SKIP_VERSION_CHECK ??= "1";

process.title = AGENT_NAME;
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = AGENT_NAME;
// Same as pi's CLI setup: runtime warnings would corrupt the terminal UI.
process.emitWarning = () => {};
