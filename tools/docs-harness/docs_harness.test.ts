// SPDX-License-Identifier: MPL-2.0

import { assert, assertEquals } from "@std/assert";
import {
  extractChromeFeatureDiscovery,
  extractWindowActors,
  parseDenoTasksFromText,
  parseFelesCommandsFromText,
  parseWorkflowRunCommands,
} from "./collector.ts";
import {
  codexAuditSchema,
  seedCodexDocs,
  verifyCodexAuditResult,
} from "./codex.ts";
import {
  escapeMdxText,
  generateDocsPayload,
  LLM_AUTHORED_PAGE_PATHS,
  normalizeGeneratedBody,
  readLlmConfig,
  writeGeneratedDocs,
} from "./generator.ts";
import {
  readAuditLlmConfig,
  runLlmAudit,
  verifyLlmAuditResult,
} from "./llm_audit.ts";
import { verifyDocsHarness } from "./verifier.ts";
import { REQUIRED_GENERATED_PAGE_PATHS } from "./types.ts";
import type { DocsInventory, GeneratedPage } from "./types.ts";

Deno.test("parseDenoTasksFromText reads sorted task entries", () => {
  const tasks = parseDenoTasksFromText(
    JSON.stringify({
      tasks: {
        "test:smoke": "deno run -A tools/src/smoke_runner.ts",
        "feles-build": "deno run -A tools/feles-build.ts",
      },
    }),
  );

  assertEquals(tasks.map((task) => task.name), ["feles-build", "test:smoke"]);
  assertEquals(tasks[0].command, "deno run -A tools/feles-build.ts");
});

Deno.test("parseFelesCommandsFromText reads command switch cases", () => {
  const commands = parseFelesCommandsFromText(`
    switch (command) {
      case "dev":
        console.log("Usage: feles-build dev");
        break;
      case "build":
        console.log("Usage: feles-build build --phase <before-mach|after-mach>");
        break;
      case "--help":
        break;
    }
  `);

  assertEquals(commands.map((command) => command.name), ["build", "dev"]);
  assertEquals(
    commands[0].usage,
    "Usage: feles-build build --phase <before-mach|after-mach>",
  );
});

Deno.test("extractChromeFeatureDiscovery reads import.meta.glob pattern", () => {
  const discovery = extractChromeFeatureDiscovery(`
    export function getFeaturesCommonEntries() {
      return import.meta.glob("./*/index.ts");
    }
  `);

  assertEquals(discovery.globPattern, "./*/index.ts");
});

Deno.test("extractWindowActors reads addJSWindowActors and actor count", () => {
  const actors = extractWindowActors(`
    const JS_WINDOW_ACTORS: {
      [k: string]: WindowActorOptions;
    } = {
      NRSettings: {
        parent: {},
      },
      NRPanelSidebar: {
        child: {},
      },
    };
    ActorManagerParent.addJSWindowActors(JS_WINDOW_ACTORS);
  `);

  assertEquals(actors.registrationApi, "ActorManagerParent.addJSWindowActors");
  assertEquals(actors.actorCount, 2);
});

Deno.test("parseWorkflowRunCommands reads inline and block run commands", () => {
  const commands = parseWorkflowRunCommands(`
    steps:
      - run: deno task test:smoke
      - name: Start browser and run integration tests
        run: |
          set -euo pipefail
          mkdir -p _dist
          deno install
          deno task feles-build test > _dist/ci.log 2>&1 &
          deno task docs-harness generate \\
            --inventory _dist/docs-harness/inventory.json \\
            --out _dist/docs-harness/generated
          test -n "\${DOCS_PUBLISH_TOKEN}"
          for i in {1..300}; do
            sleep 2
          done
          deno task test --no-autostart
      - run: deno test -A tools/src/colocated_test_runner.test.ts
  `);

  assertEquals(commands, [
    "deno install",
    "deno task docs-harness generate --inventory _dist/docs-harness/inventory.json --out _dist/docs-harness/generated",
    "deno task feles-build test > _dist/ci.log 2>&1 &",
    "deno task test --no-autostart",
    "deno task test:smoke",
    "deno test -A tools/src/colocated_test_runner.test.ts",
    "mkdir -p _dist",
    "sleep 2",
  ]);
});

Deno.test("readLlmConfig omits empty API keys for local compatible endpoints", () => {
  const config = readLlmConfig({
    DOCS_LLM_BASE_URL: "http://localhost:11434/v1",
    DOCS_LLM_MODEL: "llama3.1",
    DOCS_LLM_API_KEY: "",
  });

  assertEquals(config.apiKey, undefined);
  assertEquals(config.temperature, 0);
});

Deno.test("readAuditLlmConfig falls back to generation config", () => {
  const config = readAuditLlmConfig({
    DOCS_LLM_BASE_URL: "https://ollama.com/v1",
    DOCS_LLM_MODEL: "glm-5.2",
    DOCS_LLM_API_KEY: "docs-key",
    DOCS_AUDIT_LLM_BASE_URL: "",
    DOCS_AUDIT_LLM_MODEL: "kimi-k2.7-code",
  });

  assertEquals(config.baseUrl, "https://ollama.com/v1");
  assertEquals(config.model, "kimi-k2.7-code");
  assertEquals(config.apiKey, "docs-key");
});

Deno.test("normalizeGeneratedBody converts escaped newlines to real newlines", () => {
  assertEquals(
    normalizeGeneratedBody("# Title\\n\\nBody\\ttext"),
    "# Title\n\nBody  text",
  );
});

Deno.test("escapeMdxText escapes placeholders outside fenced code", () => {
  assertEquals(
    escapeMdxText([
      "> quoted source note",
      "| Command |",
      "| `feles-build build --phase <before-mach|after-mach>` |",
      "Literal expression {danger}",
      "```bash",
      "feles-build build --phase <before-mach|after-mach>",
      "echo {safe in fence}",
      "```",
    ].join("\n")),
    [
      "> quoted source note",
      "| Command |",
      "| `feles-build build --phase &lt;before-mach|after-mach&gt;` |",
      "Literal expression &#123;danger&#125;",
      "```bash",
      "feles-build build --phase <before-mach|after-mach>",
      "echo {safe in fence}",
      "```",
    ].join("\n"),
  );
});

Deno.test("generateDocsPayload uses OpenAI-compatible chat completions", async () => {
  let sawAuthorizationHeader = false;
  let requestCount = 0;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0 },
    async (request) => {
      requestCount++;
      sawAuthorizationHeader = request.headers.has("Authorization");
      const body = await request.json() as {
        model?: string;
        messages?: Array<{ role: string; content: string }>;
        response_format?: unknown;
      };

      assertEquals(body.model, "mock-model");
      assert(Array.isArray(body.messages), "messages must be an array");
      assertEquals(body.response_format, undefined);

      return Response.json({
        choices: [
          {
            message: {
              content:
                "# Page\n\nChrome features are discovered from `browser-features/chrome/common/mod.ts`.",
            },
          },
        ],
      });
    },
  );

  try {
    const payload = await generateDocsPayload(sampleInventory(), {
      baseUrl: `http://127.0.0.1:${server.addr.port}/v1`,
      model: "mock-model",
      temperature: 0,
      useJsonResponseFormat: true,
    });

    assertEquals(sawAuthorizationHeader, false);
    assertEquals(requestCount, LLM_AUTHORED_PAGE_PATHS.length);
    assertEquals(payload.pages.length, REQUIRED_GENERATED_PAGE_PATHS.length);
    assertEquals(
      payload.pages[0].path,
      "development/architecture-overview.mdx",
    );
    assert(
      payload.pages[0].body.includes(
        "browser-features/chrome/common/mod.ts",
      ),
    );
  } finally {
    await server.shutdown();
  }
});

Deno.test("generateDocsPayload retries missing page content", async () => {
  let requestCount = 0;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0 },
    () => {
      requestCount++;
      if (requestCount === 1) {
        return Response.json({
          choices: [{ message: {} }],
        });
      }

      return Response.json({
        choices: [
          {
            message: {
              content:
                "Chrome features are discovered from `browser-features/chrome/common/mod.ts`.",
            },
          },
        ],
      });
    },
  );

  try {
    const payload = await generateDocsPayload(sampleInventory(), {
      baseUrl: `http://127.0.0.1:${server.addr.port}/v1`,
      model: "mock-model",
      temperature: 0,
      useJsonResponseFormat: true,
    });

    assertEquals(payload.pages.length, REQUIRED_GENERATED_PAGE_PATHS.length);
    assertEquals(requestCount, LLM_AUTHORED_PAGE_PATHS.length + 1);
  } finally {
    await server.shutdown();
  }
});

Deno.test("generateDocsPayload escapes raw MDX body from model", async () => {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0 },
    () =>
      Response.json({
        choices: [
          {
            message: {
              content:
                "Use `browser-features/chrome/common/mod.ts` with <unsafe> and {expr}.",
            },
          },
        ],
      }),
  );

  try {
    const payload = await generateDocsPayload(sampleInventory(), {
      baseUrl: `http://127.0.0.1:${server.addr.port}/v1`,
      model: "mock-model",
      temperature: 0,
      useJsonResponseFormat: true,
    });

    assert(payload.pages[0].body.includes("&lt;unsafe&gt;"));
    assert(payload.pages[0].body.includes("&#123;expr&#125;"));
  } finally {
    await server.shutdown();
  }
});

Deno.test("runLlmAudit uses OpenAI-compatible chat completions", async () => {
  const dir = await Deno.makeTempDir();
  let sawAuthorizationHeader = false;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0 },
    async (request) => {
      sawAuthorizationHeader = request.headers.has("Authorization");
      const body = await request.json() as {
        model?: string;
        messages?: unknown;
        response_format?: unknown;
      };

      assertEquals(body.model, "audit-model");
      assert(Array.isArray(body.messages), "messages must be an array");
      assertEquals(body.response_format, { type: "json_object" });

      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                pass: true,
                blocking_findings: [],
                warnings: ["Architecture page can be expanded later."],
                recommendation: "Publish with review.",
              }),
            },
          },
        ],
      });
    },
  );

  try {
    await writeSampleGeneratedPages(dir);
    const audit = await runLlmAudit(sampleInventory(), dir, {
      baseUrl: `http://127.0.0.1:${server.addr.port}/v1`,
      model: "audit-model",
      temperature: 0,
      useJsonResponseFormat: true,
    });

    assertEquals(sawAuthorizationHeader, false);
    assertEquals(audit.pass, true);
  } finally {
    await server.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyLlmAuditResult rejects blocking audits", () => {
  for (
    const value of [
      { pass: "true", blocking_findings: [], warnings: [], recommendation: "" },
      {
        pass: false,
        blocking_findings: ["Missing source citation"],
        warnings: [],
        recommendation: "Do not publish.",
      },
      {
        pass: true,
        blocking_findings: ["Invented command"],
        warnings: [],
        recommendation: "Do not publish.",
      },
    ]
  ) {
    let rejected = false;
    try {
      verifyLlmAuditResult(value);
    } catch {
      rejected = true;
    }
    assert(rejected, "invalid LLM audit should be rejected");
  }
});

function sampleInventory(): DocsInventory {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-26T00:00:00.000Z",
    floorpCommit: "abc",
    sourcePrecedence: [
      "code/config/CI/test scripts",
      "repo docs",
      "external docs",
    ],
    commands: {
      denoTasks: [
        {
          name: "feles-build",
          command: "deno run -A tools/feles-build.ts",
          source: { path: "deno.json" },
        },
        {
          name: "dev-tool",
          command: "deno run -A tools/dev-tool.ts",
          source: { path: "deno.json" },
        },
        {
          name: "docs-harness:collect",
          command:
            "deno run --allow-read --allow-write=_dist --allow-run=git tools/docs-harness/mod.ts collect",
          source: { path: "deno.json" },
        },
        {
          name: "docs-harness:verify",
          command:
            "deno run --allow-read --allow-write=_dist tools/docs-harness/mod.ts verify",
          source: { path: "deno.json" },
        },
        {
          name: "docs-harness:audit",
          command:
            "deno run --allow-read --allow-write=_dist --allow-env=DOCS_LLM_BASE_URL,DOCS_LLM_MODEL,DOCS_LLM_API_KEY,DOCS_LLM_TEMPERATURE,DOCS_LLM_RESPONSE_FORMAT,DOCS_AUDIT_LLM_BASE_URL,DOCS_AUDIT_LLM_MODEL,DOCS_AUDIT_LLM_API_KEY,DOCS_AUDIT_LLM_TEMPERATURE,DOCS_AUDIT_LLM_RESPONSE_FORMAT --allow-net tools/docs-harness/mod.ts audit",
          source: { path: "deno.json" },
        },
        {
          name: "test:docs-harness",
          command:
            "deno test --allow-read --allow-write --allow-net=127.0.0.1 tools/docs-harness/",
          source: { path: "deno.json" },
        },
      ],
      felesBuild: ["dev", "test", "stage", "build", "misc"].map((name) => ({
        name,
        source: { path: "tools/feles-build.ts" },
      })),
    },
    architecture: {
      layers: [],
      referenceSources: [
        {
          area: "Loader entrypoint",
          source: { path: "bridge/loader-features/loader/index.ts" },
          summary: "Loader entrypoint.",
        },
        {
          area: "Test runner",
          source: { path: "tools/src/colocated_test_runner.ts" },
          summary: "Browser test runner.",
        },
      ],
      chromeFeatureDiscovery: {
        globPattern: "./*/index.ts",
        source: { path: "browser-features/chrome/common/mod.ts" },
      },
      windowActors: {
        registrationApi: "ActorManagerParent.addJSWindowActors",
        actorCount: 2,
        source: {
          path: "browser-features/modules/modules/BrowserGlue.sys.mts",
        },
      },
      bridgeLoader: {
        devLoaderUrl: "http://localhost:5181/loader/index.ts",
        testLoaderUrl: "http://localhost:5181/loader/test/index.ts",
        productionLoader: "chrome://noraneko/content/core.js",
        source: { path: "bridge/startup/src/chrome_root.ts" },
      },
      loaderDevServer: {
        port: 5181,
        source: { path: "bridge/loader-features/vite.config.ts" },
      },
    },
    ci: { workflows: [] },
    features: {
      chromeCommon: [
        {
          name: "workspaces",
          source: {
            path: "browser-features/chrome/common/workspaces/index.ts",
          },
          summary: "Initializes the Workspaces chrome feature.",
          entrypoints: ["default class Workspaces", "init"],
        },
      ],
      chromeStatic: [
        {
          name: "prefs",
          source: { path: "browser-features/chrome/static/prefs/index.ts" },
          summary: "Provides pre-session preference initialization.",
          entrypoints: ["initBeforeSessionStoreInit", "init"],
        },
      ],
      settingsRoutes: [
        {
          route: "/overview/home",
          component: "@/app/dashboard/page.tsx",
          source: { path: "browser-features/pages-settings/src/App.tsx" },
        },
      ],
      windowActors: [
        {
          name: "NRSettings",
          source: {
            path: "browser-features/modules/modules/BrowserGlue.sys.mts",
          },
        },
      ],
    },
    knownDriftChecks: ["deno task dev", "ActorManagerParent.addActors"],
  };
}

function sampleInventoryWithCiCommands(): DocsInventory {
  const inventory = sampleInventory();
  return {
    ...inventory,
    ci: {
      workflows: [
        {
          name: "(CI) Browser Integration + Runner Tests",
          path: ".github/workflows/colocated_runner_test.yml",
          triggers: ["pull_request", "push", "workflow_dispatch"],
          permissions: ["contents:read"],
          runCommands: [
            "deno task feles-build test > _dist/ci-feles-build-test.log 2>&1 &",
            "deno task test --no-autostart",
            "deno task test:smoke",
          ],
        },
      ],
    },
  };
}

function sampleGeneratedPages(): GeneratedPage[] {
  return REQUIRED_GENERATED_PAGE_PATHS.map((pagePath) => ({
    path: pagePath,
    title: pagePath.split("/").at(-1)!.replace(".mdx", ""),
    sidebar_label: pagePath.split("/").at(-1)!.replace(".mdx", ""),
    body:
      "Chrome features are discovered from `browser-features/chrome/common/mod.ts`.",
  }));
}

async function writeSampleGeneratedPages(
  dir: string,
  inventory: DocsInventory = sampleInventory(),
): Promise<void> {
  await seedCodexDocs(
    dir,
    `${dir}/_prompt/generate.md`,
    inventory,
  );
  await Deno.remove(`${dir}/_prompt`, { recursive: true });
}

Deno.test("verifyDocsHarness rejects stale generated command examples", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/bad.mdx`,
      "Use `deno task dev` for setup. See tools/feles-build.ts.",
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assert(
      issues.some((issue) => issue.message.includes("stale command")),
      "expected stale command issue",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness does not treat dev-tool as stale dev task", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeSampleGeneratedPages(dir);
    await Deno.writeTextFile(
      `${dir}/development/architecture-overview.mdx`,
      "Use `deno task dev-tool`. See deno.json.",
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assertEquals(issues, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness rejects unknown deno task commands", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeSampleGeneratedPages(dir);
    await Deno.writeTextFile(
      `${dir}/development/architecture-overview.mdx`,
      "Run `deno task test:integration`. See deno.json.",
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assert(
      issues.some((issue) => issue.message.includes("unknown deno task")),
      "expected unknown deno task issue",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness allows explicitly framed drift strings", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeSampleGeneratedPages(dir);
    await Deno.writeTextFile(
      `${dir}/development/architecture-overview.mdx`,
      [
        "Chrome features are discovered from `browser-features/chrome/common/mod.ts`.",
        "### Outdated Docs Drift Patterns",
        "- `deno task dev`",
        "- `deno task build`",
        "- `deno task clean`",
        "- `ActorManagerParent.addActors`",
      ].join("\n"),
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assertEquals(issues, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness rejects missing required generated pages", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/development`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/development/architecture-overview.mdx`,
      "Chrome features are discovered from `browser-features/chrome/common/mod.ts`.",
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assert(
      issues.some((issue) => issue.message.includes("missing required page")),
      "expected missing required page issue",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness rejects raw MDX angle brackets outside fences", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeSampleGeneratedPages(dir);
    await Deno.writeTextFile(
      `${dir}/development/architecture-overview.mdx`,
      "Use `feles-build build --phase <before-mach|after-mach>`. See tools/feles-build.ts.",
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assert(
      issues.some((issue) => issue.message.includes("raw angle brackets")),
      "expected raw angle bracket issue",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness rejects MDX executable syntax", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeSampleGeneratedPages(dir);
    await Deno.writeTextFile(
      `${dir}/development/architecture-overview.mdx`,
      [
        "import Dangerous from './Dangerous'",
        "Chrome features are discovered from `browser-features/chrome/common/mod.ts`.",
        "{process.env.SECRET}",
      ].join("\n"),
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assert(
      issues.some((issue) => issue.message.includes("MDX ESM")),
      "expected MDX ESM issue",
    );
    assert(
      issues.some((issue) => issue.message.includes("MDX expressions")),
      "expected MDX expression issue",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness allows public LLM env key names but rejects publish tokens", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeSampleGeneratedPages(dir);
    await Deno.writeTextFile(
      `${dir}/development/architecture-overview.mdx`,
      [
        "Chrome features are discovered from `browser-features/chrome/common/mod.ts`.",
        "Optional auth uses `DOCS_LLM_API_KEY`.",
        "Publishing uses `DOCS_PUBLISH_TOKEN`.",
      ].join("\n"),
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assert(
      issues.some((issue) =>
        issue.message.includes("secret or credential identifiers")
      ),
      "expected publish token issue",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness rejects literal escaped newlines", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeSampleGeneratedPages(dir);
    await Deno.writeTextFile(
      `${dir}/development/architecture-overview.mdx`,
      "# Architecture\\n\\nChrome features are discovered from `browser-features/chrome/common/mod.ts`.",
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assert(
      issues.some((issue) => issue.message.includes("literal escape")),
      "expected literal escape issue",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness rejects nonexistent referenced source paths", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeSampleGeneratedPages(dir);
    await Deno.writeTextFile(
      `${dir}/development/architecture-overview.mdx`,
      [
        "Chrome features are discovered from `browser-features/chrome/common/mod.ts`.",
        "The inventory lives at `tools/docs-harness/inventory.json`.",
      ].join("\n"),
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assert(
      issues.some((issue) =>
        issue.message.includes("referenced source path does not exist")
      ),
      "expected nonexistent source path issue",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness rejects unusable CI summaries", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeSampleGeneratedPages(dir, sampleInventoryWithCiCommands());
    await Deno.writeTextFile(
      `${dir}/development/reference/ci-test-reference.mdx`,
      [
        "See `.github/workflows/colocated_runner_test.yml`.",
        "| Workflow | Commands |",
        "|---|---|",
        "| Browser Integration | None |",
      ].join("\n"),
    );

    const issues = await verifyDocsHarness(
      sampleInventoryWithCiCommands(),
      dir,
    );
    assert(
      issues.some((issue) =>
        issue.message.includes("missing workflow run command")
      ),
      "expected missing CI run command issue",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeGeneratedDocs stabilizes CI reference from inventory", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeGeneratedDocs(
      dir,
      {
        pages: sampleGeneratedPages().map((page) =>
          page.path === "development/reference/ci-test-reference.mdx"
            ? {
              ...page,
              body: "Bad model output with den o task test:smoke.",
            }
            : page
        ),
      },
      sampleInventoryWithCiCommands(),
    );

    const text = await Deno.readTextFile(
      `${dir}/development/reference/ci-test-reference.mdx`,
    );
    assert(text.includes("deno task test:smoke"));
    assert(text.includes("deno task test --no-autostart"));
    assert(
      text.includes(
        "deno task feles-build test > _dist/ci-feles-build-test.log 2>&1 &",
      ),
    );
    assert(!text.includes("den o task"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeGeneratedDocs stabilizes command reference from inventory", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeGeneratedDocs(
      dir,
      {
        pages: sampleGeneratedPages().map((page) =>
          page.path === "development/reference/command-reference.mdx"
            ? {
              ...page,
              body: "Bad model output without feles-build subcommands.",
            }
            : page
        ),
      },
      sampleInventory(),
    );

    const text = await Deno.readTextFile(
      `${dir}/development/reference/command-reference.mdx`,
    );
    for (const command of ["dev", "test", "stage", "build", "misc"]) {
      assert(text.includes(`feles-build ${command}`));
    }
    assert(text.includes("tools/feles-build.ts"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeGeneratedDocs generates nested feature and actor catalogs from inventory", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeGeneratedDocs(
      dir,
      { pages: sampleGeneratedPages() },
      sampleInventory(),
    );

    const commonOverview = await Deno.readTextFile(
      `${dir}/development/features/browser-features/common/overview.mdx`,
    );
    assert(commonOverview.includes("Common Chrome Feature Categories"));
    assert(commonOverview.includes("Tabs & Workspaces"));

    const tabsCatalog = await Deno.readTextFile(
      `${dir}/development/features/browser-features/common/tabs-and-workspaces.mdx`,
    );
    assert(tabsCatalog.includes("workspaces"));
    assert(
      tabsCatalog.includes(
        "browser-features/chrome/common/workspaces/index.ts",
      ),
    );

    const actorCatalog = await Deno.readTextFile(
      `${dir}/development/features/browser-features/modules/settings-and-internal-pages-actors.mdx`,
    );
    assert(actorCatalog.includes("NRSettings"));
    assert(
      actorCatalog.includes(
        "browser-features/modules/modules/BrowserGlue.sys.mts",
      ),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness rejects stale deterministic catalog pages", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeSampleGeneratedPages(dir);
    await Deno.writeTextFile(
      `${dir}/development/features/browser-features/common/tabs-and-workspaces.mdx`,
      [
        "Chrome features are discovered from `browser-features/chrome/common/mod.ts`.",
        "This stale page omits the inventory-backed workspaces row.",
      ].join("\n"),
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assert(
      issues.some((issue) =>
        issue.message.includes("deterministic generated page is stale")
      ),
      "expected stale deterministic page issue",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyDocsHarness ignores volatile commit changes in deterministic pages", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const generatedInventory = sampleInventory();
    await writeSampleGeneratedPages(dir, generatedInventory);

    const pullRequestInventory = {
      ...generatedInventory,
      floorpCommit: "synthetic-pr-merge-commit",
    };
    const issues = await verifyDocsHarness(pullRequestInventory, dir);

    assertEquals(issues, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("seedCodexDocs writes required docs and prompt", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const docsDir = `${dir}/generated`;
    const promptPath = `${dir}/codex/generate.md`;
    const written = await seedCodexDocs(docsDir, promptPath, sampleInventory());

    assertEquals(written.length, REQUIRED_GENERATED_PAGE_PATHS.length);
    for (const pagePath of REQUIRED_GENERATED_PAGE_PATHS) {
      const filePath = `${docsDir}/${pagePath}`;
      const text = await Deno.readTextFile(filePath);
      assert(text.includes("floorp_commit"));
      assert(
        text.includes("browser-features") ||
          text.includes("deno.json") ||
          text.includes(".github/workflows") ||
          text.includes("tools/feles-build.ts"),
      );
    }

    const prompt = await Deno.readTextFile(promptPath);
    assert(prompt.includes("_dist/docs-harness/inventory.json"));
    assert(prompt.includes("architecture-overview.mdx"));
    assert(prompt.includes("browser-features/chrome/common/mod.ts"));
    assert(!prompt.includes("TOKEN"));
    assert(!prompt.includes("API_KEY"));
    assert(!prompt.includes("secrets."));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("verifyCodexAuditResult accepts passing audit", () => {
  const audit = verifyCodexAuditResult({
    pass: true,
    blocking_findings: [],
    warnings: ["Architecture page could be more detailed."],
    recommendation: "Use generated docs.",
  });

  assertEquals(audit.pass, true);
});

Deno.test("verifyCodexAuditResult rejects malformed or blocking audits", () => {
  for (
    const value of [
      "{bad json}",
      { pass: "true", blocking_findings: [], warnings: [], recommendation: "" },
      {
        pass: false,
        blocking_findings: ["Missing source citation"],
        warnings: [],
        recommendation: "Do not publish.",
      },
      {
        pass: true,
        blocking_findings: ["Missing source citation"],
        warnings: [],
        recommendation: "Do not publish.",
      },
    ]
  ) {
    let rejected = false;
    try {
      if (typeof value === "string") {
        JSON.parse(value);
      } else {
        verifyCodexAuditResult(value);
      }
    } catch {
      rejected = true;
    }
    assert(rejected, "invalid Codex audit should be rejected");
  }
});

Deno.test("codexAuditSchema requires pass and finding fields", () => {
  const schema = codexAuditSchema() as {
    required?: string[];
    additionalProperties?: boolean;
  };

  assertEquals(schema.additionalProperties, false);
  assertEquals(schema.required, [
    "pass",
    "blocking_findings",
    "warnings",
    "recommendation",
  ]);
});

Deno.test("verifyDocsHarness accepts source-backed generated MDX", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeSampleGeneratedPages(dir);
    await Deno.writeTextFile(
      `${dir}/development/architecture-overview.mdx`,
      [
        "Chrome features are discovered from `browser-features/chrome/common/mod.ts`.",
        "See [Command Reference](./reference/command-reference).",
      ].join("\n"),
    );

    const issues = await verifyDocsHarness(sampleInventory(), dir);
    assertEquals(issues, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
