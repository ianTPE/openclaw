import type { Command } from "commander";
import {
  formatDocsLink,
  formatHelpExamples,
  theme,
} from "openclaw/plugin-sdk/memory-core-host-runtime-cli";
import type { MemoryCommandOptions, MemorySearchCommandOptions, MemoryStateCommandOptions } from "./cli.types.js";

type MemoryCliRuntime = typeof import("./cli.runtime.js");

let memoryCliRuntimePromise: Promise<MemoryCliRuntime> | null = null;

async function loadMemoryCliRuntime(): Promise<MemoryCliRuntime> {
  memoryCliRuntimePromise ??= import("./cli.runtime.js");
  return await memoryCliRuntimePromise;
}

export async function runMemoryStatus(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryStatus(opts);
}

async function runMemoryIndex(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryIndex(opts);
}

async function runMemorySearch(queryArg: string | undefined, opts: MemorySearchCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemorySearch(queryArg, opts);
}

async function runMemoryPromptPreview(
  queryArg: string | undefined,
  opts: MemorySearchCommandOptions,
) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemorySearch(queryArg, opts);
}

async function runMemoryStateShow(opts: MemoryStateCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryStateShow(opts);
}

async function runMemoryStatePrecheck(opts: MemoryStateCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryStatePrecheck(opts);
}

async function runMemoryStateApplySuccess(opts: MemoryStateCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryStateApplySuccess(opts);
}

async function runMemoryStateApplyFailure(opts: MemoryStateCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryStateApplyFailure(opts);
}

export function registerMemoryCli(program: Command) {
  const memory = program
    .command("memory")
    .description("Search, inspect, and reindex memory files")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["openclaw memory status", "Show index and provider status."],
          ["openclaw memory status --deep", "Probe embedding provider readiness."],
          ["openclaw memory index --force", "Force a full reindex."],
          ['openclaw memory search "meeting notes"', "Search memory via CtxFST retrieval."],
          [
            'openclaw memory search --expand-graph "What is required before Analyze Resume?"',
            "Search with one-hop graph expansion.",
          ],
          [
            'openclaw memory search --token-limit 8000 "deployment"',
            "Search with a custom token budget.",
          ],
          [
            "openclaw memory state show --session my-session",
            "Show world state for a session.",
          ],
          [
            "openclaw memory state precheck --session my-session --entity entity:analyze-resume",
            "Check preconditions for an entity.",
          ],
          ["openclaw memory status --json", "Output machine-readable JSON (good for scripts)."],
        ])}\n\n${theme.muted("Docs:")} ${formatDocsLink("/cli/memory", "docs.openclaw.ai/cli/memory")}\n`,
    );

  memory
    .command("status")
    .description("Show memory search index status")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .option("--deep", "Probe embedding provider availability")
    .option("--index", "Reindex if dirty (implies --deep)")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions & { force?: boolean }) => {
      await runMemoryStatus(opts);
    });

  memory
    .command("index")
    .description("Reindex memory files")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--force", "Force full reindex", false)
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryIndex(opts);
    });

  memory
    .command("search")
    .description("Search memory files via CtxFST retrieval")
    .argument("[query]", "Search query")
    .option("--query <text>", "Search query (alternative to positional argument)")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--expand-graph", "Enable one-hop graph expansion", false)
    .option("--token-limit <n>", "Prompt token limit", (value: string) => Number(value))
    .option("--json", "Print JSON")
    .option("--verbose", "Verbose logging", false)
    .action(async (queryArg: string | undefined, opts: MemorySearchCommandOptions) => {
      await runMemorySearch(queryArg, opts);
    });

  memory
    .command("prompt-preview")
    .description("Alias for 'memory search' (deprecated)")
    .argument("[query]", "Search query")
    .option("--query <text>", "Search query (alternative to positional argument)")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--expand-graph", "Enable one-hop graph expansion", false)
    .option("--token-limit <n>", "Prompt token limit", (value: string) => Number(value))
    .option("--json", "Print JSON")
    .option("--verbose", "Verbose logging", false)
    .action(async (queryArg: string | undefined, opts: MemorySearchCommandOptions) => {
      await runMemoryPromptPreview(queryArg, opts);
    });

  const state = memory
    .command("state")
    .description("Inspect and update CtxFST session world state");

  state
    .command("show")
    .description("Show world state for a session")
    .requiredOption("--session <id>", "Session id")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryStateCommandOptions) => {
      await runMemoryStateShow(opts);
    });

  state
    .command("precheck")
    .description("Check whether preconditions for an entity are satisfied")
    .requiredOption("--session <id>", "Session id")
    .requiredOption("--entity <id>", "Entity id to check")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryStateCommandOptions) => {
      await runMemoryStatePrecheck(opts);
    });

  state
    .command("apply-success")
    .description("Record successful execution and write postconditions to session state")
    .requiredOption("--session <id>", "Session id")
    .requiredOption("--entity <id>", "Entity id that succeeded")
    .option("--summary <text>", "Optional result summary")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryStateCommandOptions) => {
      await runMemoryStateApplySuccess(opts);
    });

  state
    .command("apply-failure")
    .description("Record failed execution and add entity to blocked_by")
    .requiredOption("--session <id>", "Session id")
    .requiredOption("--entity <id>", "Entity id that failed")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryStateCommandOptions) => {
      await runMemoryStateApplyFailure(opts);
    });
}
