import type { Command } from "commander";
import {
  formatDocsLink,
  formatHelpExamples,
  theme,
} from "openclaw/plugin-sdk/memory-core-host-runtime-cli";
import type { MemoryCommandOptions, MemorySearchCommandOptions } from "./cli.types.js";

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
}
