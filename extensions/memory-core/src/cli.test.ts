import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import {
  firstWrittenJsonArg,
  spyRuntimeErrors,
  spyRuntimeJson,
  spyRuntimeLogs,
} from "openclaw/plugin-sdk/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getMemorySearchManager = vi.hoisted(() => vi.fn());
const loadConfig = vi.hoisted(() => vi.fn(() => ({})));
const resolveDefaultAgentId = vi.hoisted(() => vi.fn(() => "main"));
const resolveCommandSecretRefsViaGateway = vi.hoisted(() =>
  vi.fn(async ({ config }: { config: unknown }) => ({
    resolvedConfig: config,
    diagnostics: [] as string[],
  })),
);

vi.mock("openclaw/plugin-sdk/memory-core-host-runtime-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("openclaw/plugin-sdk/memory-core-host-runtime-core")>();
  return {
    ...actual,
    loadConfig,
    resolveDefaultAgentId,
  };
});

vi.mock("openclaw/plugin-sdk/memory-core-host-runtime-cli", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("openclaw/plugin-sdk/memory-core-host-runtime-cli")>();
  return {
    ...actual,
    resolveCommandSecretRefsViaGateway,
  };
});

vi.mock("./memory/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./memory/index.js")>();
  return {
    ...actual,
    getMemorySearchManager,
  };
});

let registerMemoryCli: typeof import("./cli.js").registerMemoryCli;
let defaultRuntime: typeof import("openclaw/plugin-sdk/memory-core-host-runtime-cli").defaultRuntime;
let isVerbose: typeof import("openclaw/plugin-sdk/memory-core-host-runtime-cli").isVerbose;
let setVerbose: typeof import("openclaw/plugin-sdk/memory-core-host-runtime-cli").setVerbose;

beforeAll(async () => {
  ({ registerMemoryCli } = await import("./cli.js"));
  ({ defaultRuntime, isVerbose, setVerbose } =
    await import("openclaw/plugin-sdk/memory-core-host-runtime-cli"));
});

beforeEach(() => {
  getMemorySearchManager.mockReset();
  loadConfig.mockReset().mockReturnValue({});
  resolveDefaultAgentId.mockReset().mockReturnValue("main");
  resolveCommandSecretRefsViaGateway.mockReset().mockImplementation(async ({ config }) => ({
    resolvedConfig: config,
    diagnostics: [] as string[],
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  setVerbose(false);
});

describe("memory cli", () => {
  const inactiveMemorySecretDiagnostic = "agents.defaults.memorySearch.remote.apiKey inactive"; // pragma: allowlist secret

  function expectCliSync(sync: ReturnType<typeof vi.fn>) {
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "cli", force: false, progress: expect.any(Function) }),
    );
  }

  function makeMemoryStatus(overrides: Record<string, unknown> = {}) {
    return {
      files: 0,
      chunks: 0,
      dirty: false,
      workspaceDir: "/tmp/openclaw",
      dbPath: "/tmp/memory.sqlite",
      provider: "openai",
      model: "text-embedding-3-small",
      requestedProvider: "openai",
      vector: { enabled: true, available: true },
      ...overrides,
    };
  }

  function mockManager(manager: Record<string, unknown>) {
    getMemorySearchManager.mockResolvedValueOnce({ manager });
  }

  function setupMemoryStatusWithInactiveSecretDiagnostics(close: ReturnType<typeof vi.fn>) {
    resolveCommandSecretRefsViaGateway.mockResolvedValueOnce({
      resolvedConfig: {},
      diagnostics: [inactiveMemorySecretDiagnostic] as string[],
    });
    mockManager({
      probeVectorAvailability: vi.fn(async () => true),
      status: () => makeMemoryStatus({ workspaceDir: undefined }),
      close,
    });
  }

  function hasLoggedInactiveSecretDiagnostic(spy: ReturnType<typeof vi.spyOn>) {
    return spy.mock.calls.some(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes(inactiveMemorySecretDiagnostic),
    );
  }

  async function runMemoryCli(args: string[]) {
    const program = new Command();
    program.name("test");
    registerMemoryCli(program);
    await program.parseAsync(["memory", ...args], { from: "user" });
  }

  function captureHelpOutput(command: Command | undefined) {
    let output = "";
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write);
    try {
      command?.outputHelp();
      return output;
    } finally {
      writeSpy.mockRestore();
    }
  }

  async function copyCtxfstFixture(targetPath: string) {
    const fixturePath = path.resolve(
      import.meta.dirname,
      "../../../docs/openclaw-upgrade-specs/examples/retrieval-test.ctxfst.md",
    );
    const source = await fs.readFile(fixturePath, "utf8");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, source, "utf8");
  }

  function getMemoryHelpText() {
    const program = new Command();
    registerMemoryCli(program);
    const memoryCommand = program.commands.find((command) => command.name() === "memory");
    return captureHelpOutput(memoryCommand);
  }

  async function withQmdIndexDb(content: string, run: (dbPath: string) => Promise<void>) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-cli-qmd-index-"));
    const dbPath = path.join(tmpDir, "index.sqlite");
    try {
      await fs.writeFile(dbPath, content, "utf-8");
      await run(dbPath);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  async function expectCloseFailureAfterCommand(params: {
    args: string[];
    manager: Record<string, unknown>;
    beforeExpect?: () => void;
  }) {
    const close = vi.fn(async () => {
      throw new Error("close boom");
    });
    mockManager({ ...params.manager, close });

    const error = spyRuntimeErrors(defaultRuntime);
    await runMemoryCli(params.args);

    params.beforeExpect?.();
    expect(close).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Memory manager close failed: close boom"),
    );
    expect(process.exitCode).toBeUndefined();
  }

  it("prints vector status when available", async () => {
    const close = vi.fn(async () => {});
    mockManager({
      probeVectorAvailability: vi.fn(async () => true),
      status: () =>
        makeMemoryStatus({
          files: 2,
          chunks: 5,
          cache: { enabled: true, entries: 123, maxEntries: 50000 },
          fts: { enabled: true, available: true },
          vector: {
            enabled: true,
            available: true,
            extensionPath: "/opt/sqlite-vec.dylib",
            dims: 1024,
          },
        }),
      close,
    });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["status"]);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("Vector: ready"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Vector dims: 1024"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Vector path: /opt/sqlite-vec.dylib"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("FTS: ready"));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Embedding cache: enabled (123 entries)"),
    );
    expect(close).toHaveBeenCalled();
  });

  it("resolves configured memory SecretRefs through gateway snapshot", async () => {
    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          memorySearch: {
            remote: {
              apiKey: { source: "env", provider: "default", id: "MEMORY_REMOTE_API_KEY" },
            },
          },
        },
      },
    });
    const close = vi.fn(async () => {});
    mockManager({
      probeVectorAvailability: vi.fn(async () => true),
      status: () => makeMemoryStatus(),
      close,
    });

    await runMemoryCli(["status"]);

    expect(resolveCommandSecretRefsViaGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        commandName: "memory status",
        targetIds: new Set([
          "agents.defaults.memorySearch.remote.apiKey",
          "agents.list[].memorySearch.remote.apiKey",
        ]),
      }),
    );
  });

  it("logs gateway secret diagnostics for non-json status output", async () => {
    const close = vi.fn(async () => {});
    setupMemoryStatusWithInactiveSecretDiagnostics(close);

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["status"]);

    expect(hasLoggedInactiveSecretDiagnostic(log)).toBe(true);
  });

  it("documents memory help examples", () => {
    const helpText = getMemoryHelpText();

    expect(helpText).toContain("openclaw memory status --deep");
    expect(helpText).toContain("Probe embedding provider readiness.");
    expect(helpText).toContain('openclaw memory search "meeting notes"');
    expect(helpText).toContain("Search memory via CtxFST retrieval.");
    expect(helpText).toContain("openclaw memory search --expand-graph");
    expect(helpText).toContain("Search with one-hop graph expansion.");
    expect(helpText).toContain('openclaw memory search --token-limit 8000 "deployment"');
    expect(helpText).toContain("Search with a custom token budget.");
  });

  it("renders ctxfst prompt preview with graph expansion", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-cli-prompt-preview-"));
    const workspaceDir = path.join(tmpDir, "workspace");
    await copyCtxfstFixture(path.join(workspaceDir, "memory", "retrieval-test.ctxfst.md"));

    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            enabled: true,
            provider: "openai",
          },
        },
      },
    });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli([
      "prompt-preview",
      "What is required before Analyze Resume?",
      "--expand-graph",
    ]);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("## Relevant Entities"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Analyze Resume"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("## Related Entities (Graph)"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("REQUIRES"));

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("prints vector error when unavailable", async () => {
    const close = vi.fn(async () => {});
    mockManager({
      probeVectorAvailability: vi.fn(async () => false),
      status: () =>
        makeMemoryStatus({
          dirty: true,
          vector: {
            enabled: true,
            available: false,
            loadError: "load failed",
          },
        }),
      close,
    });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["status", "--agent", "main"]);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("Vector: unavailable"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Vector error: load failed"));
    expect(close).toHaveBeenCalled();
  });

  it("prints embeddings status when deep", async () => {
    const close = vi.fn(async () => {});
    const probeEmbeddingAvailability = vi.fn(async () => ({ ok: true }));
    mockManager({
      probeVectorAvailability: vi.fn(async () => true),
      probeEmbeddingAvailability,
      status: () => makeMemoryStatus({ files: 1, chunks: 1 }),
      close,
    });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["status", "--deep"]);

    expect(probeEmbeddingAvailability).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Embeddings: ready"));
    expect(close).toHaveBeenCalled();
  });

  it("enables verbose logging with --verbose", async () => {
    const close = vi.fn(async () => {});
    mockManager({
      probeVectorAvailability: vi.fn(async () => true),
      status: () => makeMemoryStatus(),
      close,
    });

    await runMemoryCli(["status", "--verbose"]);

    expect(isVerbose()).toBe(true);
  });

  it("logs close failure after status", async () => {
    await expectCloseFailureAfterCommand({
      args: ["status"],
      manager: {
        probeVectorAvailability: vi.fn(async () => true),
        status: () => makeMemoryStatus({ files: 1, chunks: 1 }),
      },
    });
  });

  it("reindexes on status --index", async () => {
    const close = vi.fn(async () => {});
    const sync = vi.fn(async () => {});
    const probeEmbeddingAvailability = vi.fn(async () => ({ ok: true }));
    mockManager({
      probeVectorAvailability: vi.fn(async () => true),
      probeEmbeddingAvailability,
      sync,
      status: () => makeMemoryStatus({ files: 1, chunks: 1 }),
      close,
    });

    spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["status", "--index"]);

    expectCliSync(sync);
    expect(probeEmbeddingAvailability).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("closes manager after index", async () => {
    const close = vi.fn(async () => {});
    const sync = vi.fn(async () => {});
    mockManager({ sync, close });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["index"]);

    expectCliSync(sync);
    expect(close).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Memory index updated (main).");
  });

  it("logs qmd index file path and size after index", async () => {
    const close = vi.fn(async () => {});
    const sync = vi.fn(async () => {});
    await withQmdIndexDb("sqlite-bytes", async (dbPath) => {
      mockManager({ sync, status: () => ({ backend: "qmd", dbPath }), close });

      const log = spyRuntimeLogs(defaultRuntime);
      await runMemoryCli(["index"]);

      expectCliSync(sync);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("QMD index: "));
      expect(log).toHaveBeenCalledWith("Memory index updated (main).");
      expect(close).toHaveBeenCalled();
    });
  });

  it("fails index when qmd db file is empty", async () => {
    const close = vi.fn(async () => {});
    const sync = vi.fn(async () => {});
    await withQmdIndexDb("", async (dbPath) => {
      mockManager({ sync, status: () => ({ backend: "qmd", dbPath }), close });

      const error = spyRuntimeErrors(defaultRuntime);
      await runMemoryCli(["index"]);

      expectCliSync(sync);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("Memory index failed (main): QMD index file is empty"),
      );
      expect(close).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  it("logs close failures without failing the command", async () => {
    const sync = vi.fn(async () => {});
    await expectCloseFailureAfterCommand({
      args: ["index"],
      manager: { sync },
      beforeExpect: () => {
        expectCliSync(sync);
      },
    });
  });

  it("renders search results via ctxfst pipeline", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-cli-search-ctxfst-"));
    const workspaceDir = path.join(tmpDir, "workspace");
    await copyCtxfstFixture(path.join(workspaceDir, "memory", "retrieval-test.ctxfst.md"));

    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: { enabled: true, provider: "openai" },
        },
      },
    });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["search", "What is required before Analyze Resume?"]);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("## Relevant Entities"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Analyze Resume"));

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("search with --expand-graph includes graph entities", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-cli-search-graph-"));
    const workspaceDir = path.join(tmpDir, "workspace");
    await copyCtxfstFixture(path.join(workspaceDir, "memory", "retrieval-test.ctxfst.md"));

    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: { enabled: true, provider: "openai" },
        },
      },
    });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["search", "What is required before Analyze Resume?", "--expand-graph"]);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("## Relevant Entities"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("## Related Entities (Graph)"));

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("prints status json output when requested", async () => {
    const close = vi.fn(async () => {});
    mockManager({
      probeVectorAvailability: vi.fn(async () => true),
      status: () => makeMemoryStatus({ workspaceDir: undefined }),
      close,
    });

    const writeJson = spyRuntimeJson(defaultRuntime);
    await runMemoryCli(["status", "--json"]);

    const payload = firstWrittenJsonArg<unknown[]>(writeJson);
    expect(payload).not.toBeNull();
    if (!payload) {
      throw new Error("expected json payload");
    }
    expect(Array.isArray(payload)).toBe(true);
    expect((payload[0] as Record<string, unknown>)?.agentId).toBe("main");
    expect(close).toHaveBeenCalled();
  });

  it("routes gateway secret diagnostics to stderr for json status output", async () => {
    const close = vi.fn(async () => {});
    setupMemoryStatusWithInactiveSecretDiagnostics(close);

    const writeJson = spyRuntimeJson(defaultRuntime);
    const error = spyRuntimeErrors(defaultRuntime);
    await runMemoryCli(["status", "--json"]);

    const payload = firstWrittenJsonArg<unknown[]>(writeJson);
    expect(payload).not.toBeNull();
    if (!payload) {
      throw new Error("expected json payload");
    }
    expect(Array.isArray(payload)).toBe(true);
    expect(hasLoggedInactiveSecretDiagnostic(error)).toBe(true);
  });

  it("logs default message when memory manager is missing", async () => {
    getMemorySearchManager.mockResolvedValueOnce({ manager: null });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["status"]);

    expect(log).toHaveBeenCalledWith("Memory search disabled.");
  });

  it("logs backend unsupported message when index has no sync", async () => {
    const close = vi.fn(async () => {});
    mockManager({
      status: () => makeMemoryStatus(),
      close,
    });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["index"]);

    expect(log).toHaveBeenCalledWith("Memory backend does not support manual reindex.");
    expect(close).toHaveBeenCalled();
  });

  it("prints no-files message when no ctxfst documents exist", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-cli-search-empty-"));
    const workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });

    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: { enabled: true, provider: "openai" },
        },
      },
    });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["search", "hello"]);

    expect(log).toHaveBeenCalledWith("No .ctxfst.md memory files found.");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("accepts --query for memory search", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-cli-search-query-"));
    const workspaceDir = path.join(tmpDir, "workspace");
    await copyCtxfstFixture(path.join(workspaceDir, "memory", "retrieval-test.ctxfst.md"));

    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: { enabled: true, provider: "openai" },
        },
      },
    });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["search", "--query", "Analyze Resume"]);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("## Relevant Entities"));
    expect(process.exitCode).toBeUndefined();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("prefers --query when positional and flag are both provided", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-cli-search-prefer-"));
    const workspaceDir = path.join(tmpDir, "workspace");
    await copyCtxfstFixture(path.join(workspaceDir, "memory", "retrieval-test.ctxfst.md"));

    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: { enabled: true, provider: "openai" },
        },
      },
    });

    const log = spyRuntimeLogs(defaultRuntime);
    await runMemoryCli(["search", "positional", "--query", "Analyze Resume"]);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("Analyze Resume"));

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("fails when neither positional query nor --query is provided", async () => {
    const error = spyRuntimeErrors(defaultRuntime);
    await runMemoryCli(["search"]);

    expect(error).toHaveBeenCalledWith(
      "Missing search query. Provide a positional query or use --query <text>.",
    );
    expect(getMemorySearchManager).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("prints search results as json when requested", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-cli-search-json-"));
    const workspaceDir = path.join(tmpDir, "workspace");
    await copyCtxfstFixture(path.join(workspaceDir, "memory", "retrieval-test.ctxfst.md"));

    loadConfig.mockReturnValue({
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: { enabled: true, provider: "openai" },
        },
      },
    });

    const writeJson = spyRuntimeJson(defaultRuntime);
    await runMemoryCli(["search", "Analyze Resume", "--json"]);

    const payload = firstWrittenJsonArg<{
      query: string;
      resolvedQuery: string;
      documents: string[];
      contextPack: unknown;
      prompt: unknown;
      rendered: string;
    }>(writeJson);
    expect(payload).not.toBeNull();
    if (!payload) {
      throw new Error("expected json payload");
    }
    expect(payload.query).toBe("Analyze Resume");
    expect(payload.documents).toHaveLength(1);
    expect(payload.rendered).toContain("Analyze Resume");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
