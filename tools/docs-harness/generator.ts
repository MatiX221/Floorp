// SPDX-License-Identifier: MPL-2.0

import * as path from "@std/path";
import type {
  DocsInventory,
  GeneratedDocsPayload,
  GeneratedPage,
} from "./types.ts";
import {
  DETERMINISTIC_GENERATED_PAGE_PATHS,
  REQUIRED_GENERATED_PAGE_PATHS,
} from "./types.ts";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type CommonFeatureCategory = {
  path: string;
  title: string;
  sidebarLabel: string;
  summary: string;
  names: string[];
};

type ActorCategory = {
  path: string;
  title: string;
  sidebarLabel: string;
  summary: string;
  names: string[];
};

const COMMON_FEATURE_CATEGORIES: CommonFeatureCategory[] = [
  {
    path:
      "development/features/browser-features/common/tabs-and-workspaces.mdx",
    title: "Tabs & Workspaces",
    sidebarLabel: "Tabs & Workspaces",
    summary:
      "Tab, tab strip, workspace, split-view, closed-tab, and tab-sleep related chrome features.",
    names: [
      "split-view",
      "tab",
      "tab-sleep-exclusion",
      "tabbar",
      "undo-closed-tab",
      "workspaces",
    ],
  },
  {
    path: "development/features/browser-features/common/sidebar-and-panels.mdx",
    title: "Sidebar & Panels",
    sidebarLabel: "Sidebar & Panels",
    summary:
      "Panel sidebar, menu panel, status bar, and sidebar positioning features.",
    names: [
      "hub-panel-menu",
      "panel-sidebar",
      "reboot-panel-menu",
      "reverse-sidebar-position",
      "statusbar",
    ],
  },
  {
    path:
      "development/features/browser-features/common/browser-ui-customization.mdx",
    title: "Browser UI Customization",
    sidebarLabel: "UI Customization",
    summary:
      "Chrome CSS, design, ordering, tab color, UI customization, and focused UI mode features.",
    names: [
      "browser-tab-color",
      "chrome-css",
      "designs",
      "flex-order",
      "ui-custom",
      "zen-mode",
    ],
  },
  {
    path:
      "development/features/browser-features/common/input-and-shortcuts.mdx",
    title: "Input & Shortcuts",
    sidebarLabel: "Input & Shortcuts",
    summary:
      "Keyboard, mouse gesture, context menu, and command palette interaction features.",
    names: [
      "command-palette",
      "context-menu",
      "keyboard-shortcut",
      "mouse-gesture",
    ],
  },
  {
    path:
      "development/features/browser-features/common/webapps-and-integration.mdx",
    title: "Web Apps & Integration",
    sidebarLabel: "Web Apps",
    summary:
      "PWA, profile, add-on, external browser, share mode, and container integration features.",
    names: [
      "addons",
      "browser-share-mode",
      "external-browser",
      "private-container",
      "profile-manager",
      "pwa",
    ],
  },
  {
    path:
      "development/features/browser-features/common/utilities-and-actions.mdx",
    title: "Utilities & Actions",
    sidebarLabel: "Utilities",
    summary:
      "Small chrome utilities and action helpers that do not own a broader feature family.",
    names: ["modal-parent", "qr-code-generator"],
  },
];

const ACTOR_CATEGORIES: ActorCategory[] = [
  {
    path:
      "development/features/browser-features/modules/settings-and-internal-pages-actors.mdx",
    title: "Settings & Internal Page Actors",
    sidebarLabel: "Settings Actors",
    summary:
      "Actors used by settings, internal pages, localization, browser constants, restart, modal, search, and tab-manager surfaces.",
    names: [
      "NRAboutPreferences",
      "NRAppConstants",
      "NRChromeModal",
      "NRExperimemmt",
      "NRI18n",
      "NRPanelSidebar",
      "NRRestartBrowser",
      "NRSearchEngine",
      "NRSettings",
      "NRStartPage",
      "NRSyncManager",
      "NRTabManager",
      "NRWelcomePage",
    ],
  },
  {
    path:
      "development/features/browser-features/modules/web-content-and-store-actors.mdx",
    title: "Web Content & Store Actors",
    sidebarLabel: "Web Content Actors",
    summary:
      "Actors that connect browser chrome with web content, scraping, automation, plugin-store, chrome-web-store, and scroll gesture behavior.",
    names: [
      "NRChromeWebStore",
      "NRMouseGestureScroll",
      "NROSAutomotor",
      "NRPluginStore",
      "NRWebScraper",
    ],
  },
  {
    path:
      "development/features/browser-features/modules/pwa-workspaces-profile-actors.mdx",
    title: "PWA, Workspaces & Profile Actors",
    sidebarLabel: "PWA & Workspaces",
    summary:
      "Actors that support PWA windows, workspace state, PWA management, and profile management.",
    names: [
      "NRProfileManager",
      "NRProgressiveWebApp",
      "NRPwaManager",
      "NRWorkspaces",
    ],
  },
];

const DETERMINISTIC_PAGE_PATH_SET = new Set<string>(
  DETERMINISTIC_GENERATED_PAGE_PATHS,
);

export const LLM_AUTHORED_PAGE_PATHS = REQUIRED_GENERATED_PAGE_PATHS.filter(
  (pagePath) => !DETERMINISTIC_PAGE_PATH_SET.has(pagePath),
);

class LlmHttpError extends Error {
  constructor(readonly status: number) {
    super(`LLM request failed with HTTP ${status}`);
  }
}

export type LlmConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature: number;
  useJsonResponseFormat: boolean;
};

function joinChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

export function readLlmConfig(env?: Record<string, string>): LlmConfig {
  const readEnv = (key: string): string | undefined =>
    env ? env[key] : Deno.env.get(key);
  const baseUrl = readEnv("DOCS_LLM_BASE_URL");
  const model = readEnv("DOCS_LLM_MODEL");

  if (!baseUrl) {
    throw new Error("DOCS_LLM_BASE_URL is required for docs generation");
  }
  if (!model) {
    throw new Error("DOCS_LLM_MODEL is required for docs generation");
  }

  return {
    baseUrl,
    model,
    apiKey: readEnv("DOCS_LLM_API_KEY") || undefined,
    temperature: Number(readEnv("DOCS_LLM_TEMPERATURE") ?? "0"),
    useJsonResponseFormat: readEnv("DOCS_LLM_RESPONSE_FORMAT") !== "disabled",
  };
}

function generationMessages(
  inventory: DocsInventory,
  requiredPages: readonly string[] = REQUIRED_GENERATED_PAGE_PATHS,
): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You generate source-backed developer documentation for Floorp.",
        "Return only valid JSON.",
        "Do not invent commands, APIs, file paths, or behavior.",
        "Every architecture claim must cite source paths from the inventory.",
        "Never include secrets, environment values, endpoint URLs, or raw prompts.",
        "Do not present known drift strings as current commands or APIs.",
        "For CI, only say a workflow runs a command when that exact command appears in the workflow runCommands inventory.",
        "For CI, list representative raw runCommands from the inventory; never write None for a workflow that has runCommands.",
        "For CI/test docs, focus on .github/workflows/colocated_runner_test.yml and .github/workflows/docs_harness.yml; avoid release, publish, signing, and deployment commands.",
        "For authored architecture and directory pages, prefer comprehensive nested explanations over shallow summaries when the inventory provides enough source evidence.",
        "Use real Markdown newlines. Do not include literal \\n or \\t escape sequences in MDX body text.",
        "Write English Docusaurus-compatible MDX body content.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Generate Floorp developer docs as Docusaurus-compatible MDX.",
        output_schema: {
          pages: [
            {
              path: requiredPages[0],
              title: "Page title",
              sidebar_label: "Sidebar label",
              body: "MDX content without frontmatter",
            },
          ],
        },
        required_pages: requiredPages,
        inventory,
      }),
    },
  ];
}

function singlePageMessages(
  inventory: DocsInventory,
  pagePath: string,
): ChatMessage[] {
  const citationPaths = allowedCitationPaths(inventory);
  return [
    {
      role: "system",
      content: [
        "You write source-backed developer documentation for Floorp.",
        "Return only the MDX body for the requested page.",
        "Do not include frontmatter, JSON, Markdown code fences around the whole page, imports, exports, JSX, or MDX expressions.",
        "Do not invent commands, APIs, file paths, or behavior.",
        "Every architecture claim must cite exact source file paths from the allowed citation list.",
        "Do not cite directories, generated output paths, wildcard paths, command-only paths, or paths that are only mentioned inside workflow shell commands.",
        "Never include secrets, environment values, endpoint URLs, or raw prompts.",
        "Do not present known drift strings as current commands or APIs.",
        "Write English Docusaurus-compatible MDX body content.",
        "Prefer comprehensive nested explanations over shallow summaries when the inventory provides enough source evidence.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Generate one Floorp developer docs page.",
        page_path: pagePath,
        page_title: titleForPage(pagePath),
        output:
          "Return only the MDX body text for this page. Do not wrap it in JSON.",
        allowed_citation_paths: citationPaths,
        inventory,
      }),
    },
  ];
}

function allowedCitationPaths(inventory: DocsInventory): string[] {
  return [
    ...new Set([
      ...inventory.commands.denoTasks.map((task) => task.source.path),
      ...inventory.commands.felesBuild.map((command) => command.source.path),
      ...inventory.architecture.layers.map((layer) => layer.source.path),
      ...inventory.architecture.referenceSources.map((entry) =>
        entry.source.path
      ),
      inventory.architecture.chromeFeatureDiscovery.source.path,
      inventory.architecture.windowActors.source.path,
      inventory.architecture.bridgeLoader.source.path,
      inventory.architecture.loaderDevServer.source.path,
      ...inventory.features.chromeCommon.map((feature) => feature.source.path),
      ...inventory.features.chromeStatic.map((feature) => feature.source.path),
      ...inventory.features.settingsRoutes.map((route) => route.source.path),
      ...inventory.features.windowActors.map((actor) => actor.source.path),
      ...inventory.ci.workflows.map((workflow) => workflow.path),
    ]),
  ].sort();
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error("LLM response did not contain a JSON object");
}

function validateGeneratedPayload(
  value: unknown,
  requiredPaths: readonly string[] = REQUIRED_GENERATED_PAGE_PATHS,
): GeneratedDocsPayload {
  if (!value || typeof value !== "object") {
    throw new Error("Generated payload must be an object");
  }

  const pages = (value as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) {
    throw new Error("Generated payload must include a pages array");
  }

  const validatedPages: GeneratedPage[] = pages.map((page, index) => {
    if (!page || typeof page !== "object") {
      throw new Error(`Generated page ${index} must be an object`);
    }
    const candidate = page as Partial<GeneratedPage>;
    for (const key of ["path", "title", "sidebar_label", "body"] as const) {
      if (typeof candidate[key] !== "string" || candidate[key]!.trim() === "") {
        throw new Error(`Generated page ${index} is missing ${key}`);
      }
    }
    validatePagePath(candidate.path!, index);
    return {
      ...candidate,
      body: escapeMdxText(normalizeGeneratedBody(candidate.body!)),
    } as GeneratedPage;
  });

  const requiredPathSet = new Set(requiredPaths);
  const generatedPaths = new Set<string>();
  for (const page of validatedPages) {
    if (generatedPaths.has(page.path)) {
      throw new Error(
        `Generated payload includes duplicate page: ${page.path}`,
      );
    }
    generatedPaths.add(page.path);
    if (!requiredPathSet.has(page.path)) {
      throw new Error(
        `Generated payload includes unrequested page: ${page.path}`,
      );
    }
  }
  for (const requiredPath of requiredPaths) {
    if (!generatedPaths.has(requiredPath)) {
      throw new Error(
        `Generated payload is missing required page: ${requiredPath}`,
      );
    }
  }

  return { pages: validatedPages };
}

function validatePagePath(pagePath: string, index: number): void {
  if (pagePath.includes("\\") || path.isAbsolute(pagePath)) {
    throw new Error(`Generated page ${index} path must be relative POSIX`);
  }

  const segments = pagePath.split("/");
  if (
    segments.some((segment) =>
      segment === "" || segment === ".." || segment === "."
    )
  ) {
    throw new Error(`Generated page ${index} path contains unsafe segments`);
  }

  if (!pagePath.startsWith("development/")) {
    throw new Error(`Generated page ${index} must live under development/`);
  }
  if (!pagePath.endsWith(".mdx")) {
    throw new Error(`Generated page ${index} must use .mdx`);
  }
}

export function normalizeGeneratedBody(text: string): string {
  return text
    .replaceAll("\\r\\n", "\n")
    .replaceAll("\\n", "\n")
    .replaceAll("\\t", "  ");
}

function normalizeSinglePageBody(text: string): string {
  const normalized = normalizeGeneratedBody(text).trim();
  const fenced = normalized.match(/^```(?:mdx|markdown|md)?\s*([\s\S]+?)```$/);
  return fenced ? fenced[1].trim() : normalized;
}

export function escapeMdxText(text: string): string {
  let inFence = false;
  return text.split(/\r?\n/).map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) {
      return line;
    }
    return line
      .replace(/<([^>\n]+)>/g, "&lt;$1&gt;")
      .replaceAll("{", "&#123;")
      .replaceAll("}", "&#125;");
  }).join("\n");
}

export async function generateDocsPayload(
  inventory: DocsInventory,
  config: LlmConfig,
): Promise<GeneratedDocsPayload> {
  const pages: GeneratedPage[] = [];
  for (const pagePath of LLM_AUTHORED_PAGE_PATHS) {
    const pagePayload = await requestGeneratedPayload(inventory, config, [
      pagePath,
    ]);
    const exactPage = pagePayload.pages.find((page) => page.path === pagePath);
    if (!exactPage) {
      throw new Error(`Fallback response omitted requested page: ${pagePath}`);
    }
    pages.push(exactPage);
  }
  pages.push(
    ...DETERMINISTIC_GENERATED_PAGE_PATHS.map((pagePath) =>
      deterministicPagePlaceholder(pagePath)
    ),
  );
  return { pages };
}

async function requestGeneratedPayload(
  inventory: DocsInventory,
  config: LlmConfig,
  requiredPages: readonly string[],
): Promise<GeneratedDocsPayload> {
  if (requiredPages.length === 1) {
    return {
      pages: [
        await requestSingleGeneratedPage(
          inventory,
          config,
          requiredPages[0],
        ),
      ],
    };
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await requestGeneratedPayloadOnce(
        inventory,
        config,
        requiredPages,
      );
    } catch (error) {
      if (
        error instanceof LlmHttpError &&
        (error.status === 401 || error.status === 403)
      ) {
        throw error;
      }
      lastError = error;
    }
  }

  const pageList = requiredPages.join(", ");
  const message = lastError instanceof Error ? lastError.message : lastError;
  throw new Error(`LLM generation failed for ${pageList}: ${message}`);
}

async function requestSingleGeneratedPage(
  inventory: DocsInventory,
  config: LlmConfig,
  pagePath: string,
): Promise<GeneratedPage> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const body = await requestSingleGeneratedPageOnce(
        inventory,
        config,
        pagePath,
      );
      return {
        path: pagePath,
        title: titleForPage(pagePath),
        sidebar_label: sidebarLabelForPage(pagePath),
        body: escapeMdxText(normalizeSinglePageBody(body)),
      };
    } catch (error) {
      if (
        error instanceof LlmHttpError &&
        (error.status === 401 || error.status === 403)
      ) {
        throw error;
      }
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : lastError;
  throw new Error(`LLM generation failed for ${pagePath}: ${message}`);
}

async function requestSingleGeneratedPageOnce(
  inventory: DocsInventory,
  config: LlmConfig,
  pagePath: string,
): Promise<string> {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (config.apiKey) {
    headers.set("Authorization", `Bearer ${config.apiKey}`);
  }

  const response = await fetch(joinChatCompletionsUrl(config.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: singlePageMessages(inventory, pagePath),
      temperature: config.temperature,
    }),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new LlmHttpError(response.status);
  }

  const json = await response.json() as ChatResponse;
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM response did not include message content");
  }
  return content;
}

async function requestGeneratedPayloadOnce(
  inventory: DocsInventory,
  config: LlmConfig,
  requiredPages: readonly string[],
): Promise<GeneratedDocsPayload> {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (config.apiKey) {
    headers.set("Authorization", `Bearer ${config.apiKey}`);
  }

  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages: generationMessages(inventory, requiredPages),
    temperature: config.temperature,
  };
  if (config.useJsonResponseFormat) {
    requestBody.response_format = { type: "json_object" };
  }

  let response = await fetch(joinChatCompletionsUrl(config.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (
    !response.ok &&
    config.useJsonResponseFormat &&
    (response.status === 400 || response.status === 422)
  ) {
    await response.body?.cancel();
    delete requestBody.response_format;
    response = await fetch(joinChatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new LlmHttpError(response.status);
  }

  const json = await response.json() as ChatResponse;
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM response did not include message content");
  }

  return validateGeneratedPayload(
    JSON.parse(extractJson(content)),
    requiredPages,
  );
}

function frontmatter(page: GeneratedPage, inventory: DocsInventory): string {
  return [
    "---",
    `title: ${JSON.stringify(page.title)}`,
    `sidebar_label: ${JSON.stringify(page.sidebar_label)}`,
    `floorp_commit: ${JSON.stringify(inventory.floorpCommit)}`,
    "generated: true",
    "---",
    "",
  ].join("\n");
}

function deterministicPagePlaceholder(pagePath: string): GeneratedPage {
  return {
    path: pagePath,
    title: titleForPage(pagePath),
    sidebar_label: sidebarLabelForPage(pagePath),
    body:
      "This page is generated deterministically from the Floorp docs inventory.",
  };
}

function titleForPage(pagePath: string): string {
  switch (pagePath) {
    case "development/architecture-overview.mdx":
      return "Architecture Overview";
    case "development/directories/bridge.mdx":
      return "Bridge Directory";
    case "development/directories/browser-features/overview.mdx":
      return "Browser Features Overview";
    case "development/directories/browser-features/chrome/overview.mdx":
      return "Chrome Features Overview";
    case "development/directories/browser-features/chrome/common.mdx":
      return "Common Chrome Features";
    case "development/directories/browser-features/chrome/static.mdx":
      return "Static Chrome Features";
    case "development/directories/browser-features/modules/overview.mdx":
      return "Modules Overview";
    case "development/directories/browser-features/modules/browser-glue.mdx":
      return "BrowserGlue & Window Actors";
    case "development/directories/browser-features/pages-settings/overview.mdx":
      return "Settings Pages Overview";
    case "development/directories/browser-features/pages-settings/build.mdx":
      return "Settings Pages Build";
    case "development/directories/browser-features/pages-settings/routing.mdx":
      return "Settings Pages Routing";
    case "development/directories/tools-and-ci.mdx":
      return "Tools & CI Directories";
    case "development/directories/static-gecko.mdx":
      return "Static Gecko Directory";
    case "development/features/browser-features/overview.mdx":
      return "Browser Features Catalog";
    case "development/features/browser-features/chrome-common.mdx":
      return "Common Chrome Feature Catalog";
    case "development/features/browser-features/chrome-static.mdx":
      return "Static Chrome Feature Catalog";
    case "development/features/browser-features/settings-pages.mdx":
      return "Settings Page Feature Catalog";
    case "development/features/browser-features/window-actors.mdx":
      return "Window Actor Catalog";
    case "development/features/browser-features/common/overview.mdx":
      return "Common Chrome Feature Categories";
    case "development/features/browser-features/common/tabs-and-workspaces.mdx":
      return "Tabs & Workspaces";
    case "development/features/browser-features/common/sidebar-and-panels.mdx":
      return "Sidebar & Panels";
    case "development/features/browser-features/common/browser-ui-customization.mdx":
      return "Browser UI Customization";
    case "development/features/browser-features/common/input-and-shortcuts.mdx":
      return "Input & Shortcuts";
    case "development/features/browser-features/common/webapps-and-integration.mdx":
      return "Web Apps & Integration";
    case "development/features/browser-features/common/utilities-and-actions.mdx":
      return "Utilities & Actions";
    case "development/features/browser-features/modules/overview.mdx":
      return "Window Actor Categories";
    case "development/features/browser-features/modules/settings-and-internal-pages-actors.mdx":
      return "Settings & Internal Page Actors";
    case "development/features/browser-features/modules/web-content-and-store-actors.mdx":
      return "Web Content & Store Actors";
    case "development/features/browser-features/modules/pwa-workspaces-profile-actors.mdx":
      return "PWA, Workspaces & Profile Actors";
    case "development/reference/source-inventory.mdx":
      return "Source Inventory";
    case "development/reference/command-reference.mdx":
      return "Command Reference";
    case "development/reference/ci-test-reference.mdx":
      return "CI & Test Reference";
    default:
      return pagePath;
  }
}

function sidebarLabelForPage(pagePath: string): string {
  switch (pagePath) {
    case "development/architecture-overview.mdx":
      return "Architecture";
    case "development/directories/bridge.mdx":
      return "Bridge";
    case "development/directories/browser-features/overview.mdx":
    case "development/directories/browser-features/chrome/overview.mdx":
    case "development/directories/browser-features/modules/overview.mdx":
    case "development/directories/browser-features/pages-settings/overview.mdx":
      return "Overview";
    case "development/directories/browser-features/chrome/common.mdx":
      return "Common";
    case "development/directories/browser-features/chrome/static.mdx":
      return "Static";
    case "development/directories/browser-features/modules/browser-glue.mdx":
      return "BrowserGlue";
    case "development/directories/browser-features/pages-settings/build.mdx":
      return "Build";
    case "development/directories/browser-features/pages-settings/routing.mdx":
      return "Routing";
    case "development/directories/tools-and-ci.mdx":
      return "Tools & CI";
    case "development/directories/static-gecko.mdx":
      return "Static Gecko";
    case "development/features/browser-features/overview.mdx":
      return "Feature Catalog";
    case "development/features/browser-features/chrome-common.mdx":
      return "Common Chrome";
    case "development/features/browser-features/chrome-static.mdx":
      return "Static Chrome";
    case "development/features/browser-features/settings-pages.mdx":
      return "Settings Pages";
    case "development/features/browser-features/window-actors.mdx":
      return "Window Actors";
    case "development/features/browser-features/common/overview.mdx":
      return "Common Categories";
    case "development/features/browser-features/common/tabs-and-workspaces.mdx":
      return "Tabs & Workspaces";
    case "development/features/browser-features/common/sidebar-and-panels.mdx":
      return "Sidebar & Panels";
    case "development/features/browser-features/common/browser-ui-customization.mdx":
      return "UI Customization";
    case "development/features/browser-features/common/input-and-shortcuts.mdx":
      return "Input & Shortcuts";
    case "development/features/browser-features/common/webapps-and-integration.mdx":
      return "Web Apps";
    case "development/features/browser-features/common/utilities-and-actions.mdx":
      return "Utilities";
    case "development/features/browser-features/modules/overview.mdx":
      return "Actor Categories";
    case "development/features/browser-features/modules/settings-and-internal-pages-actors.mdx":
      return "Settings Actors";
    case "development/features/browser-features/modules/web-content-and-store-actors.mdx":
      return "Web Content Actors";
    case "development/features/browser-features/modules/pwa-workspaces-profile-actors.mdx":
      return "PWA & Workspaces";
    case "development/reference/source-inventory.mdx":
      return "Source Inventory";
    case "development/reference/command-reference.mdx":
      return "Commands";
    case "development/reference/ci-test-reference.mdx":
      return "CI & Tests";
    default:
      return pagePath;
  }
}

export async function writeGeneratedDocs(
  outputDir: string,
  payload: GeneratedDocsPayload,
  inventory: DocsInventory,
): Promise<string[]> {
  const written: string[] = [];
  const resolvedOutputDir = path.resolve(outputDir);
  for (const page of payload.pages) {
    validatePagePath(page.path, written.length);
    const outputPath = path.resolve(resolvedOutputDir, ...page.path.split("/"));
    const relativeOutputPath = path.relative(resolvedOutputDir, outputPath);
    if (
      relativeOutputPath.startsWith("..") || path.isAbsolute(relativeOutputPath)
    ) {
      throw new Error(
        `Refusing to write outside output directory: ${page.path}`,
      );
    }
    await Deno.mkdir(path.dirname(outputPath), { recursive: true });
    await Deno.writeTextFile(
      outputPath,
      `${frontmatter(page, inventory)}${
        finalizePageBody(page, inventory).trim()
      }\n`,
    );
    written.push(outputPath);
  }
  return written;
}

function finalizePageBody(
  page: GeneratedPage,
  inventory: DocsInventory,
): string {
  if (page.path === "development/features/browser-features/overview.mdx") {
    return buildBrowserFeaturesCatalogOverview(inventory);
  }
  if (page.path === "development/features/browser-features/chrome-common.mdx") {
    return buildFeatureCatalogPage(
      "Common Chrome Feature Catalog",
      "Common chrome features are discovered from `browser-features/chrome/common/mod.ts` and are intended for loader-managed browser chrome behavior that can participate in hot reload.",
      inventory.features.chromeCommon,
    );
  }
  if (page.path === "development/features/browser-features/chrome-static.mdx") {
    return buildFeatureCatalogPage(
      "Static Chrome Feature Catalog",
      "Static chrome features are discovered from `browser-features/chrome/static/mod.ts`. They still participate in the loader registry, but they are for browser chrome code that should not be hot-reloaded.",
      inventory.features.chromeStatic,
    );
  }
  if (
    page.path === "development/features/browser-features/settings-pages.mdx"
  ) {
    return buildSettingsRoutesCatalog(inventory);
  }
  if (page.path === "development/features/browser-features/window-actors.mdx") {
    return buildWindowActorsCatalog(inventory);
  }
  if (
    page.path === "development/features/browser-features/common/overview.mdx"
  ) {
    return buildCommonFeatureCategoryOverview(inventory);
  }
  const commonCategory = COMMON_FEATURE_CATEGORIES.find((category) =>
    category.path === page.path
  );
  if (commonCategory) {
    return buildCommonFeatureCategoryPage(commonCategory, inventory);
  }
  if (
    page.path === "development/features/browser-features/modules/overview.mdx"
  ) {
    return buildActorCategoryOverview(inventory);
  }
  const actorCategory = ACTOR_CATEGORIES.find((category) =>
    category.path === page.path
  );
  if (actorCategory) {
    return buildActorCategoryPage(actorCategory, inventory);
  }
  if (page.path === "development/reference/source-inventory.mdx") {
    return buildSourceInventory(inventory);
  }
  if (page.path === "development/reference/command-reference.mdx") {
    return buildCommandReference(inventory);
  }
  if (page.path === "development/reference/ci-test-reference.mdx") {
    return buildCiTestReference(inventory);
  }
  return page.body;
}

function buildBrowserFeaturesCatalogOverview(
  inventory: DocsInventory,
): string {
  return [
    "# Browser Features Catalog",
    "",
    "This catalog is generated from loader-discovered chrome feature entrypoints, the settings route table, and BrowserGlue Window Actor registrations. It complements the directory deep dives by giving a feature-by-feature index.",
    "",
    "## Catalog Sections",
    "",
    `- Common chrome features: ${inventory.features.chromeCommon.length} entries from \`browser-features/chrome/common\`.`,
    `- Static chrome features: ${inventory.features.chromeStatic.length} entries from \`browser-features/chrome/static\`.`,
    `- Settings page routes: ${inventory.features.settingsRoutes.length} routes from \`browser-features/pages-settings/src/App.tsx\`.`,
    `- Window Actors: ${inventory.features.windowActors.length} actors from \`browser-features/modules/modules/BrowserGlue.sys.mts\`.`,
    "",
    "## How To Read This Catalog",
    "",
    "Use this section when you know the user-facing feature or integration point and need to find the owning source path. Use the directory pages when you need lifecycle, build, routing, or registration details.",
    "",
    "## Auto-Updated Nested Catalogs",
    "",
    "The nested common-feature and actor catalogs are generated from the same inventory. When a feature directory or BrowserGlue actor changes, assigned category tables and the uncategorized fallback lists update during the next docs-harness generation run.",
  ].join("\n");
}

function buildFeatureCatalogPage(
  title: string,
  intro: string,
  features: DocsInventory["features"]["chromeCommon"],
): string {
  return [
    `# ${title}`,
    "",
    intro,
    "",
    "## Feature Entries",
    "",
    "| Feature | Source | Entrypoints | Description |",
    "|---|---|---|---|",
    ...features.map((feature) =>
      `| ${escapeTableCell(feature.name)} | \`${feature.source.path}\` | ${
        escapeTableCell(formatList(feature.entrypoints))
      } | ${escapeTableCell(feature.summary)} |`
    ),
  ].join("\n");
}

function buildSettingsRoutesCatalog(inventory: DocsInventory): string {
  return [
    "# Settings Page Feature Catalog",
    "",
    "This page is generated from the settings route table in `browser-features/pages-settings/src/App.tsx`. It maps settings UI routes to the component import path recorded in the route owner file.",
    "",
    "| Route | Component Source | Route Source |",
    "|---|---|---|",
    ...inventory.features.settingsRoutes.map((route) =>
      `| \`${route.route}\` | \`${route.component}\` | \`${
        formatSource(route.source.path, route.source.line)
      }\` |`
    ),
  ].join("\n");
}

function buildWindowActorsCatalog(inventory: DocsInventory): string {
  return [
    "# Window Actor Catalog",
    "",
    "This page is generated from the `JS_WINDOW_ACTORS` table in `browser-features/modules/modules/BrowserGlue.sys.mts`. Actor options such as matches, events, parent modules, child modules, and frame behavior remain owned by BrowserGlue.",
    "",
    "| Actor | Source |",
    "|---|---|",
    ...inventory.features.windowActors.map((actor) =>
      `| ${escapeTableCell(actor.name)} | \`${
        formatSource(actor.source.path, actor.source.line)
      }\` |`
    ),
  ].join("\n");
}

function buildCommonFeatureCategoryOverview(
  inventory: DocsInventory,
): string {
  const uncategorized = uncategorizedCommonFeatures(inventory);
  return [
    "# Common Chrome Feature Categories",
    "",
    "This nested catalog is generated from `browser-features/chrome/common`. It groups loader-managed common chrome feature directories by product area while preserving each exact source path from the inventory.",
    "",
    "## Category Index",
    "",
    "| Category | Entries | Scope |",
    "|---|---:|---|",
    ...COMMON_FEATURE_CATEGORIES.map((category) => {
      const count = selectFeaturesByNames(
        inventory.features.chromeCommon,
        category.names,
      ).length;
      return `| [${category.title}](./${
        categorySlug(category.path)
      }) | ${count} | ${escapeTableCell(category.summary)} |`;
    }),
    ...(uncategorized.length > 0
      ? [
        `| Uncategorized | ${uncategorized.length} | Entries discovered from \`browser-features/chrome/common\` that do not yet have a docs category. |`,
      ]
      : []),
    "",
    "## Uncategorized Entries",
    "",
    ...(uncategorized.length > 0 ? featureTableRows(uncategorized) : [
      "All discovered common chrome features are currently assigned to a generated category.",
    ]),
  ].join("\n");
}

function buildCommonFeatureCategoryPage(
  category: CommonFeatureCategory,
  inventory: DocsInventory,
): string {
  const features = selectFeaturesByNames(
    inventory.features.chromeCommon,
    category.names,
  );
  return [
    `# ${category.title}`,
    "",
    `${category.summary} This page is generated from the common chrome feature inventory rooted at \`browser-features/chrome/common\`.`,
    "",
    "## Feature Entries",
    "",
    ...featureTableRows(features),
  ].join("\n");
}

function buildActorCategoryOverview(inventory: DocsInventory): string {
  const uncategorized = uncategorizedActors(inventory);
  return [
    "# Window Actor Categories",
    "",
    "This nested catalog is generated from the `JS_WINDOW_ACTORS` table in `browser-features/modules/modules/BrowserGlue.sys.mts`. It groups registered actors by the implementation surface they support while keeping BrowserGlue as the source of truth.",
    "",
    "## Category Index",
    "",
    "| Category | Entries | Scope |",
    "|---|---:|---|",
    ...ACTOR_CATEGORIES.map((category) => {
      const count = selectActorsByNames(
        inventory.features.windowActors,
        category.names,
      ).length;
      return `| [${category.title}](./${
        categorySlug(category.path)
      }) | ${count} | ${escapeTableCell(category.summary)} |`;
    }),
    ...(uncategorized.length > 0
      ? [
        `| Uncategorized | ${uncategorized.length} | Actors discovered in \`browser-features/modules/modules/BrowserGlue.sys.mts\` that do not yet have a docs category. |`,
      ]
      : []),
    "",
    "## Uncategorized Entries",
    "",
    ...(uncategorized.length > 0 ? actorTableRows(uncategorized) : [
      "All discovered Window Actors are currently assigned to a generated category.",
    ]),
  ].join("\n");
}

function buildActorCategoryPage(
  category: ActorCategory,
  inventory: DocsInventory,
): string {
  const actors = selectActorsByNames(
    inventory.features.windowActors,
    category.names,
  );
  return [
    `# ${category.title}`,
    "",
    `${category.summary} This page is generated from BrowserGlue actor registration in \`browser-features/modules/modules/BrowserGlue.sys.mts\`.`,
    "",
    "## Actor Entries",
    "",
    ...actorTableRows(actors),
  ].join("\n");
}

function featureTableRows(
  features: DocsInventory["features"]["chromeCommon"],
): string[] {
  if (features.length === 0) {
    return [
      "No entries from `browser-features/chrome/common` matched this category in the current inventory.",
    ];
  }
  return [
    "| Feature | Source | Entrypoints | Description |",
    "|---|---|---|---|",
    ...features.map((feature) =>
      `| ${escapeTableCell(feature.name)} | \`${feature.source.path}\` | ${
        escapeTableCell(formatList(feature.entrypoints))
      } | ${escapeTableCell(feature.summary)} |`
    ),
  ];
}

function actorTableRows(
  actors: DocsInventory["features"]["windowActors"],
): string[] {
  if (actors.length === 0) {
    return [
      "No actors from `browser-features/modules/modules/BrowserGlue.sys.mts` matched this category in the current inventory.",
    ];
  }
  return [
    "| Actor | Source |",
    "|---|---|",
    ...actors.map((actor) =>
      `| ${escapeTableCell(actor.name)} | \`${
        formatSource(actor.source.path, actor.source.line)
      }\` |`
    ),
  ];
}

function selectFeaturesByNames(
  features: DocsInventory["features"]["chromeCommon"],
  names: string[],
): DocsInventory["features"]["chromeCommon"] {
  const allowedNames = new Set(names);
  return features.filter((feature) => allowedNames.has(feature.name));
}

function selectActorsByNames(
  actors: DocsInventory["features"]["windowActors"],
  names: string[],
): DocsInventory["features"]["windowActors"] {
  const allowedNames = new Set(names);
  return actors.filter((actor) => allowedNames.has(actor.name));
}

function uncategorizedCommonFeatures(
  inventory: DocsInventory,
): DocsInventory["features"]["chromeCommon"] {
  const categorizedNames = new Set(
    COMMON_FEATURE_CATEGORIES.flatMap((category) => category.names),
  );
  return inventory.features.chromeCommon.filter((feature) =>
    !categorizedNames.has(feature.name)
  );
}

function uncategorizedActors(
  inventory: DocsInventory,
): DocsInventory["features"]["windowActors"] {
  const categorizedNames = new Set(
    ACTOR_CATEGORIES.flatMap((category) => category.names),
  );
  return inventory.features.windowActors.filter((actor) =>
    !categorizedNames.has(actor.name)
  );
}

function categorySlug(pagePath: string): string {
  return pagePath.split("/").at(-1)!.replace(/\.mdx$/, "");
}

function buildSourceInventory(inventory: DocsInventory): string {
  return [
    "# Source Inventory",
    "",
    `Inventory generated from Floorp commit \`${inventory.floorpCommit}\`.`,
    "",
    "## Source Precedence",
    "",
    ...inventory.sourcePrecedence.map((entry, index) =>
      `${index + 1}. ${entry}`
    ),
    "",
    "## Architecture Sources",
    "",
    "| Area | Source |",
    "|---|---|",
    ...inventory.architecture.layers.map((layer) =>
      `| ${escapeTableCell(layer.name)} | \`${layer.source.path}\` |`
    ),
    ...inventory.architecture.referenceSources.map((entry) =>
      `| ${escapeTableCell(entry.area)} | \`${entry.source.path}\` |`
    ),
    `| Chrome feature discovery | \`${inventory.architecture.chromeFeatureDiscovery.source.path}\` |`,
    `| Window Actor registration | \`${inventory.architecture.windowActors.source.path}\` |`,
    `| Startup bridge loader | \`${inventory.architecture.bridgeLoader.source.path}\` |`,
    `| Loader dev server | \`${inventory.architecture.loaderDevServer.source.path}\` |`,
    "",
    "## Command Sources",
    "",
    `- Deno tasks: \`deno.json\` (${inventory.commands.denoTasks.length} tasks)`,
    `- feles-build CLI: \`tools/feles-build.ts\` (${inventory.commands.felesBuild.length} commands)`,
    "",
    "## Feature Catalog Sources",
    "",
    `- Common chrome features: \`browser-features/chrome/common\` (${inventory.features.chromeCommon.length} entries)`,
    `- Static chrome features: \`browser-features/chrome/static\` (${inventory.features.chromeStatic.length} entries)`,
    `- Settings routes: \`browser-features/pages-settings/src/App.tsx\` (${inventory.features.settingsRoutes.length} routes)`,
    `- Window Actors: \`browser-features/modules/modules/BrowserGlue.sys.mts\` (${inventory.features.windowActors.length} actors)`,
    "",
    "## CI Sources",
    "",
    ...inventory.ci.workflows.map((workflow) =>
      `- \`${workflow.path}\` - triggers: ${formatList(workflow.triggers)}`
    ),
  ].join("\n");
}

function buildCommandReference(inventory: DocsInventory): string {
  return [
    "# Command Reference",
    "",
    "This page is generated directly from `deno.json` and `tools/feles-build.ts` so command names and usage strings stay aligned with the source tree.",
    "",
    "## Deno Tasks",
    "",
    ...inventory.commands.denoTasks.map((task) =>
      [
        `### \`deno task ${task.name}\``,
        "",
        "```bash",
        `deno task ${task.name}`,
        "```",
        "",
        `Implementation: \`${task.command}\``,
        "",
        `Source: \`${formatSource(task.source.path, task.source.line)}\``,
        "",
      ].join("\n")
    ),
    "## feles-build Commands",
    "",
    ...inventory.commands.felesBuild.map((command) =>
      [
        `### \`${command.name}\``,
        "",
        "```bash",
        command.usage?.replace(/^Usage:\s*/, "") ??
          `feles-build ${command.name}`,
        "```",
        "",
        `Source: \`${formatSource(command.source.path, command.source.line)}\``,
        "",
      ].join("\n")
    ),
  ].join("\n");
}

function buildCiTestReference(inventory: DocsInventory): string {
  const browserWorkflow = inventory.ci.workflows.find((workflow) =>
    workflow.path === ".github/workflows/colocated_runner_test.yml"
  );
  const docsWorkflow = inventory.ci.workflows.find((workflow) =>
    workflow.path === ".github/workflows/docs_harness.yml"
  );

  const browserCommands = selectCommands(browserWorkflow?.runCommands ?? [], [
    "deno task test:smoke",
    "deno task feles-build test",
    "deno task test --no-autostart",
    "deno test -A tools/src/colocated_test_runner.test.ts",
  ]);
  const docsCommands = selectCommands(docsWorkflow?.runCommands ?? [], [
    "deno task docs-harness:collect",
    "deno task docs-harness:verify",
    "deno task test:docs-harness",
    "deno task docs-harness:audit",
    "deno task docs-harness collect",
    "deno task docs-harness generate",
    "deno task docs-harness verify",
    "deno task docs-harness audit",
  ]);

  return [
    "# CI & Test Reference",
    "",
    "This page is generated from GitHub Actions workflow files and Deno task definitions. It intentionally focuses on test and documentation workflows rather than release, publishing, signing, or deployment jobs.",
    "",
    "## Browser Integration Workflow",
    "",
    `Source: \`${
      browserWorkflow?.path ?? ".github/workflows/colocated_runner_test.yml"
    }\``,
    "",
    `Triggers: ${formatList(browserWorkflow?.triggers ?? [])}`,
    "",
    "The browser integration workflow starts a virtual display, launches Floorp through `feles-build test`, waits for Marionette, and then runs colocated browser tests against that running instance.",
    "",
    "```bash",
    ...browserCommands,
    "```",
    "",
    "## Docs Harness Workflow",
    "",
    `Source: \`${docsWorkflow?.path ?? ".github/workflows/docs_harness.yml"}\``,
    "",
    `Triggers: ${formatList(docsWorkflow?.triggers ?? [])}`,
    "",
    "Pull requests collect and verify the deterministic inventory without calling an LLM. Manual dispatch and the weekly schedule generate MDX under the docs/development directory with an OpenAI-compatible LLM, verify it, run an LLM audit, and upload the generated docs artifact for review.",
    "",
    "```bash",
    ...docsCommands,
    "```",
    "",
    "## Local Verification Commands",
    "",
    "Use these source-backed commands when checking the docs harness locally:",
    "",
    "```bash",
    "deno task docs-harness:collect --out _dist/docs-harness/inventory.json",
    "deno task docs-harness:verify --inventory _dist/docs-harness/inventory.json",
    "deno task docs-harness:audit --inventory _dist/docs-harness/inventory.json --docs-dir docs --out _dist/docs-harness/llm/audit.json",
    "deno task test:docs-harness",
    "```",
  ].join("\n");
}

function selectCommands(commands: string[], prefixes: string[]): string[] {
  const selected: string[] = [];
  for (const prefix of prefixes) {
    const command = commands.find((candidate) => candidate.startsWith(prefix));
    if (command && !selected.includes(command)) {
      selected.push(command);
    }
  }
  return selected;
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|");
}

function formatSource(path: string, line?: number): string {
  return line ? `${path}:${line}` : path;
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return "not recorded in inventory";
  }
  return values.map((value) => `\`${value}\``).join(", ");
}
