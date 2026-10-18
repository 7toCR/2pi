import "./env.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, main, VERSION } from "@earendil-works/pi-coding-agent";
import { isSelfUpdate, rebrandPiText } from "./core/branding.ts";
import { importCodexConfig } from "./core/codex-import.ts";
import { initTwoPiProject } from "./core/commands.ts";
import { AGENT_NAME, AGENT_ROOT, AGENT_TITLE, ENV_PREFIX, env } from "./core/config.ts";
import { importPiConfig } from "./core/pi-import.ts";
import { PROJECT_TYPES } from "./core/project.ts";
import { createTwoPiExtension, defaultPacks, keepTwoPiSkill } from "./extension.ts";
import { applyUiDefaults } from "./ui/defaults.ts";

const args = process.argv.slice(2);
const { name: packageName, version } = JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")) as { name: string; version: string };
const flag = (name: string): string | undefined => {
	const index = args.indexOf(name);
	return index > 0 ? args[index + 1] : undefined;
};

function exitWith(run: () => string): never {
	try {
		console.log(run());
		process.exit(0);
	} catch (error) {
		console.error(`${args[0]} 失败：${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}

if (args[0] === "import-codex") {
	exitWith(() =>
		importCodexConfig({
			agentDir: getAgentDir(),
			codexHome: flag("--codex-home"),
			model: flag("--model"),
			thinking: flag("--thinking"),
			providerId: flag("--provider-id"),
		}).join("\n"),
	);
}

if (args[0] === "import-pi") {
	exitWith(() => importPiConfig({ agentDir: getAgentDir(), piDir: flag("--pi-dir") }).join("\n"));
}

if (isSelfUpdate(args)) {
	console.error(
		[
			`${AGENT_NAME} 升级：npm install -g ${packageName}@latest；源码安装则在 2pi 的目录里 git pull，再 npm install。`,
			`更新模型目录：${AGENT_NAME} update --models；更新扩展：${AGENT_NAME} update --extensions。`,
		].join("\n"),
	);
	process.exit(1);
}

if (args[0] === "init") {
	exitWith(() => {
		const type = PROJECT_TYPES.find((value) => value === args[1]);
		if (!type) throw new Error(`用法：${AGENT_NAME} init <${PROJECT_TYPES.join("|")}>`);
		return initTwoPiProject(process.cwd(), type, defaultPacks());
	});
}

if (args.includes("--version") || args.includes("-v")) {
	console.log(`${AGENT_NAME} ${version} (pi ${VERSION})`);
	process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
	console.log(`${AGENT_TITLE} ${version} — 材料 → 论文 → 专利的科研写作 agent（基于 pi ${VERSION}）

常用：
  ${AGENT_NAME}                                   在当前目录启动交互界面
  ${AGENT_NAME} init <paper|patent|both>          建立项目（2PI.md、materials/、notes/ …）
  ${AGENT_NAME} "把 paper.pdf 写成专利"             带初始请求启动
  ${AGENT_NAME} -p "把 paper.pdf 写成专利"          无头模式，完成后退出
  ${AGENT_NAME} -c                                继续上一次会话
  ${AGENT_NAME} --full-access                     关闭写入沙箱与高危命令确认
  ${AGENT_NAME} auth check --provider <id>        检查某个 provider 的凭据（与 pi auth 相同）

登录与模型（与 pi 相同，只是目录与变量名不同）：
  交互界面内 /login 登录（OAuth 订阅或 API Key，存入 ~/.2pi/agent/auth.json）、/logout 退出、/model 选模型
  兼容 OpenAI/Anthropic/Google 接口的第三方服务：写进 ~/.2pi/agent/models.json，格式与 pi 的 models.json 相同
  ${AGENT_NAME} import-pi [--pi-dir DIR]                 导入 pi 已有的 provider 与默认模型
  ${AGENT_NAME} import-codex [--model M] [--thinking xhigh] [--codex-home DIR] [--provider-id ID]
                                        从 codex 的 config.toml/auth.json 配置模型（不复制密钥）

交互界面内：/init  /paper status|init|check|compile|final  /patent <论文> [模式]  /review <草稿> [论文]
          /plan  /changes [编号]  /redline [编号]  /undo  /checkpoints  /research  /panel  /model  /login
          F2 显示或隐藏右侧流程面板，拖动中间的分隔线调整左右宽度

环境变量：${ENV_PREFIX}CODING_AGENT_DIR（配置目录，默认 ~/.2pi/agent）、${ENV_PREFIX}CODING_AGENT_SESSION_DIR、${ENV_PREFIX}OFFLINE 等
         与 pi 的 PI_* 同义；${ENV_PREFIX}USE_PI_CONFIG=1 直接使用 ~/.pi/agent；${ENV_PREFIX}SPLIT=0 不分栏；
         ${ENV_PREFIX}RECONNECT_MAX_WAIT（无界面时断网最多等待的分钟数，默认 10）；
         ${ENV_PREFIX}PYTHON、${ENV_PREFIX}PAPER_SKILL_DIR、${ENV_PREFIX}PATENT_SKILL_DIR、${ENV_PREFIX}TECTONIC / ${ENV_PREFIX}LATEXMK

以下为完整参数说明（来自 pi，名字已换成 2pi 的）：
`);
}

// pi prints its own help and subcommand usage; show it under 2pi's names.
if (args.includes("--help") || args.includes("-h")) {
	const log = console.log.bind(console);
	console.log = (...parts: unknown[]) => log(...parts.map((part) => (typeof part === "string" ? rebrandPiText(part) : part)));
}

// 2pi does not list the general-purpose skills pi discovers for the user (e.g. ~/.agents/skills);
// skills the user lists in settings or installs into 2pi's config directory stay.
const agentDir = process.env.PI_CODING_AGENT_DIR;
const factory = createTwoPiExtension({ keepSkill: (skill) => keepTwoPiSkill(skill, agentDir) });

// 2pi's display defaults go into its own config directory only, never into ~/.pi.
if (!env("USE_PI_CONFIG")) applyUiDefaults(getAgentDir());
await main(args, { extensionFactories: [{ name: "2pi", factory }] });
