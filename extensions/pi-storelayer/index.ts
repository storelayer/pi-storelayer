/**
 * pi-storelayer — Pi Extension
 *
 * Gives the AI agent direct access to the Storelayer loyalty platform.
 * Tools are auto-generated from the resource-registry manifest, grouped by domain.
 *
 * Architecture:
 *   resource-registry (source of truth) → GET /public/tools (manifest)
 *   → pi-storelayer auto-generates domain tools → POST /public/tools/:name/execute
 *
 * The extension auto-discovers API URL and key from environment, .env, or .storelayer.json.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateTail } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface StorelayerConfig {
  apiUrl: string;
  apiKey: string;
  projectId?: string;
}

function loadConfig(cwd: string): StorelayerConfig | null {
  // 1. Environment variables
  let apiUrl = process.env.STORELAYER_API_URL || process.env.STORE_LAYER_API_URL || "";
  let apiKey = process.env.STORELAYER_API_KEY || process.env.STORE_LAYER_API_KEY || "";
  let projectId = process.env.STORELAYER_PROJECT_ID || "";

  // 2. Try .env file in cwd
  if (!apiKey) {
    try {
      const envPath = path.join(cwd, ".env");
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf-8");
        for (const line of envContent.split("\n")) {
          const [key, ...rest] = line.split("=");
          const val = rest.join("=").trim().replace(/^["']|["']$/g, "");
          if (key?.trim() === "STORELAYER_API_KEY" || key?.trim() === "STORE_LAYER_API_KEY") apiKey = val;
          if (key?.trim() === "STORELAYER_API_URL" || key?.trim() === "STORE_LAYER_API_URL") apiUrl = val;
          if (key?.trim() === "STORELAYER_PROJECT_ID") projectId = val;
        }
      }
    } catch { /* ignore */ }
  }

  // 3. Try .storelayer.json in cwd
  if (!apiKey) {
    try {
      const configPath = path.join(cwd, ".storelayer.json");
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        apiUrl = config.apiUrl || config.STORELAYER_API_URL || apiUrl;
        apiKey = config.apiKey || config.STORELAYER_API_KEY || apiKey;
        projectId = config.projectId || config.STORELAYER_PROJECT_ID || projectId;
      }
    } catch { /* ignore */ }
  }

  // 4. Try .storelayer.json in home directory
  if (!apiKey) {
    try {
      const homePath = path.join(process.env.HOME || "", ".storelayer.json");
      if (fs.existsSync(homePath)) {
        const config = JSON.parse(fs.readFileSync(homePath, "utf-8"));
        apiUrl = config.apiUrl || config.STORELAYER_API_URL || apiUrl;
        apiKey = config.apiKey || config.STORELAYER_API_KEY || apiKey;
        projectId = config.projectId || config.STORELAYER_PROJECT_ID || projectId;
      }
    } catch { /* ignore */ }
  }

  if (!apiKey) return null;

  return {
    apiUrl: (apiUrl || "https://api.storelayer.io").replace(/\/$/, ""),
    apiKey,
    projectId: projectId || undefined,
  };
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

interface ToolManifest {
  name: string;
  label: string;
  description: string;
  category: "read" | "write";
  domain: string;
  parameters: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  requiresUserId: boolean;
}

function formatError(error: unknown): string {
  if (Array.isArray(error)) {
    return error.map((e: any) => {
      if (typeof e === "string") return e;
      const parts: string[] = [];
      if (e.path?.length) parts.push(`[${e.path.join(".")}]`);
      if (e.message) parts.push(e.message);
      else parts.push(JSON.stringify(e));
      return parts.join(" ");
    }).join("; ");
  }
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    const message = (obj.message as string) || "";
    const details = obj.details != null ? String(obj.details) : "";
    if (message && details) return `${message}: ${details}`;
    return message || details || JSON.stringify(error);
  }
  return String(error);
}

async function callApi(
  config: StorelayerConfig,
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const url = `${config.apiUrl}${endpoint}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({})) as Record<string, unknown>;

    if (!res.ok || json.success === false) {
      return { ok: false, status: res.status, data: json.data ?? null, error: formatError(json.error || `HTTP ${res.status}`) };
    }

    return { ok: true, status: res.status, data: json.data ?? json };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchManifest(config: StorelayerConfig): Promise<{ tools: ToolManifest[]; domains: string[] }> {
  const result = await callApi(config, "GET", "/public/tools");
  if (!result.ok) throw new Error(`Failed to fetch tool manifest: ${result.error}`);
  const data = result.data as { tools: ToolManifest[]; domains: string[] };
  return data;
}

async function executeTool(
  config: StorelayerConfig,
  toolName: string,
  params: Record<string, unknown>,
  userId?: string,
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const body: Record<string, unknown> = { params };
  if (userId) body.userId = userId;
  const result = await callApi(config, "POST", `/public/tools/${toolName}/execute`, body);
  return { ok: result.ok, data: result.data, error: result.error };
}

function ensureConfig(config: StorelayerConfig | null, ctx: ExtensionContext): StorelayerConfig | null {
  if (config) return config;
  return loadConfig(ctx.cwd);
}

function notConfigured() {
  return {
    content: [{
      type: "text" as const,
      text: "❌ Storelayer not configured. Set credentials via:\n" +
        "  1. Environment: STORELAYER_API_KEY, STORELAYER_API_URL\n" +
        "  2. .env file in working directory\n" +
        "  3. .storelayer.json in working directory or home (~/.storelayer.json)\n" +
        '     Format: { "apiKey": "...", "apiUrl": "...", "projectId": "..." }',
    }],
    details: {},
  };
}

function errorResult(msg: string, details?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: `❌ ${msg}` }], details: details || {} };
}

function successResult(prefix: string, data: unknown) {
  const output = JSON.stringify(data, null, 2);
  const truncated = truncateTail(output, { maxLines: 100, maxBytes: 20000 });
  return {
    content: [{ type: "text" as const, text: `✅ ${prefix}\n\n${truncated.content}` }],
    details: { data },
  };
}

// ---------------------------------------------------------------------------
// Domain tool generation
// ---------------------------------------------------------------------------

/** Human-friendly domain labels */
const DOMAIN_LABELS: Record<string, string> = {
  project: "Rules & Config",
  wallet: "Wallet",
  promotions: "Promotions",
  resources: "Resources",
  external_users: "Users",
  events: "Events",
  referral: "Referrals",
  stores: "Stores",
  support: "Support",
  surveys: "Surveys",
  workflows: "Workflows",
  user_workflows: "User Workflows",
  feedback: "Feedback",
  agent: "Agent",
};

/** Domain-specific prompt guidelines */
const DOMAIN_GUIDELINES: Record<string, string[]> = {
  project: [
    "Use tool 'project.add_rule' to create rules with conditions and actions.",
    "Use tool 'project.test_conditions' to test conditions against sample context WITHOUT saving.",
    "Use tool 'project.test_rule' to evaluate a saved rule against sample context.",
    "Conditions use {{ $('resource').field }} expressions. Common resources: event, user, wallet, store.",
    "Common operators: equals, gt, gte, lt, lte, contains, startsWith, endsWith, exists, is_true, regex, before, after.",
    "Common actions: reward (add points), redemption (deduct points), integration, apply_referral, complete_referral.",
    "When creating rules, translate the user's plain-language intent into conditions and actions.",
    "Always show the rule configuration to the user before creating it.",
  ],
  wallet: [
    "Use 'wallet.get_balance' to check a user's wallet — requires userId.",
    "Wallet balances are accessible in rule conditions via {{ $('wallet').balances.<assetType> }}.",
    "Use 'wallet.earn' to add points and 'wallet.spend' to deduct points.",
  ],
  promotions: [
    "Use 'promotions.evaluate_cart' to test how promotions apply to a cart.",
    "When creating promotions, ask about: discount type, conditions, validity dates, coupon codes.",
    "Always preview the promotion config before creating it.",
  ],
  resources: [
    "Resources define data sources for rule conditions (event, user, wallet, http, database).",
    "Internal resource entities: user, wallet, history, user_lookup.",
    "Resource keys must match: /^[a-zA-Z][a-zA-Z0-9_]*$/",
  ],
  external_users: [
    "Use 'external_users.get_user' to look up a user by ID.",
    "Use 'external_users.lookup_user' to find users by email, phone, or external ID.",
  ],
};

/** Extract a compact param summary from a JSON Schema object. */
function summarizeParams(schema: Record<string, unknown>): string {
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return "";
  const required = new Set((schema.required as string[]) || []);
  const parts: string[] = [];
  for (const [key, def] of Object.entries(props)) {
    const type = (def.type as string) || "any";
    const desc = def.description ? ` — ${def.description}` : "";
    parts.push(`${key}${required.has(key) ? "" : "?"}: ${type}${desc}`);
  }
  return parts.join(", ");
}

/**
 * Group manifest tools by domain and register a pi tool per domain.
 * Each domain tool has an 'action' param that maps to the specific registry tool.
 */
function registerDomainTools(
  pi: ExtensionAPI,
  manifest: ToolManifest[],
  configRef: { current: StorelayerConfig | null },
) {
  // Group tools by domain
  const byDomain = new Map<string, ToolManifest[]>();
  for (const tool of manifest) {
    const group = byDomain.get(tool.domain) || [];
    group.push(tool);
    byDomain.set(tool.domain, group);
  }

  for (const [domain, tools] of byDomain) {
    const domainLabel = DOMAIN_LABELS[domain] || domain;
    const toolName = `storelayer_${domain}`;

    // Build action names from tool names: "wallet.get_balance" → "get_balance"
    const actionNames = tools.map((t) => t.name.replace(`${domain}.`, ""));
    const actionToTool = new Map<string, ToolManifest>();
    for (let i = 0; i < tools.length; i++) {
      actionToTool.set(actionNames[i], tools[i]);
    }

    // Build description with available actions and their parameters
    const actionList = tools.map((t) => {
      const action = t.name.replace(`${domain}.`, "");
      const paramSummary = summarizeParams(t.parameters);
      return `  - ${action}: ${t.description}${paramSummary ? `\n    params: { ${paramSummary} }` : ""}`;
    }).join("\n");

    const guidelines = DOMAIN_GUIDELINES[domain] || [];

    pi.registerTool({
      name: toolName,
      label: `Storelayer ${domainLabel}`,
      description: `Manage ${domainLabel.toLowerCase()} in Storelayer.\n\nAvailable actions:\n${actionList}`,
      promptSnippet: `Storelayer ${domainLabel}: ${actionNames.join(", ")}`,
      promptGuidelines: [
        `Available actions: ${actionNames.join(", ")}`,
        ...guidelines,
        "Pass tool-specific parameters in the 'params' object.",
        "Tools that require userId: " + tools.filter((t) => t.requiresUserId).map((t) => t.name.replace(`${domain}.`, "")).join(", ") || "(none)",
      ],
      parameters: Type.Object({
        action: StringEnum(actionNames as [string, ...string[]], {
          description: "Action to perform",
        }),
        params: Type.Optional(
          Type.Record(Type.String(), Type.Unknown(), {
            description: "Parameters for the action. Check the action's description for required fields.",
          })
        ),
        user_id: Type.Optional(Type.String({
          description: "User ID (required for user-scoped actions like wallet operations)",
        })),
      }),

      async execute(_id, args, _signal, _onUpdate, ctx) {
        const cfg = ensureConfig(configRef.current, ctx);
        if (!cfg) return notConfigured();

        const toolDef = actionToTool.get(args.action);
        if (!toolDef) return errorResult(`Unknown action '${args.action}' in domain '${domain}'`);

        const result = await executeTool(
          cfg,
          toolDef.name,
          args.params || {},
          args.user_id,
        );

        if (!result.ok) {
          return errorResult(`${toolDef.name} failed: ${result.error}`, { error: result.error });
        }

        return successResult(`${domain}.${args.action}`, result.data);
      },

      renderCall(args, theme) {
        return new Text(
          theme.fg("toolTitle", theme.bold(`storelayer_${domain} `)) +
          theme.fg("accent", args.action),
          0, 0
        );
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function storelayerExtension(pi: ExtensionAPI) {
  const configRef: { current: StorelayerConfig | null } = { current: null };
  let toolsRegistered = false;

  // Load config on session start
  pi.on("session_start", async (_e, ctx) => {
    configRef.current = loadConfig(ctx.cwd);

    if (configRef.current) {
      ctx.ui.setStatus("storelayer", `🏪 Storelayer connected (${configRef.current.apiUrl})`);

      // Auto-generate tools from registry manifest
      if (!toolsRegistered) {
        try {
          const { tools: manifest } = await fetchManifest(configRef.current);
          registerDomainTools(pi, manifest, configRef);
          toolsRegistered = true;
          ctx.ui.setStatus("storelayer", `🏪 Storelayer connected — ${manifest.length} tools loaded`);
        } catch (e) {
          console.error("Failed to fetch Storelayer tool manifest:", e);
          ctx.ui.setStatus("storelayer", "🏪 Storelayer connected (manifest fetch failed — using fallback tools)");
          // Register fallback generic API tool
          registerFallbackTool(pi, configRef);
          toolsRegistered = true;
        }
      }
    }
  });

  // Inject Storelayer context into system prompt
  pi.on("before_agent_start", async (event, ctx) => {
    if (!configRef.current) return;

    const extra = `

## Storelayer Platform (CONNECTED)
You have direct access to the Storelayer loyalty & commerce platform via tools.
API: ${configRef.current.apiUrl}
${configRef.current.projectId ? `Project: ${configRef.current.projectId}` : "No default project set — ask the user which project to use."}

### How Tools Work
Tools are organized by domain (storelayer_project, storelayer_wallet, storelayer_promotions, etc.).
Each tool has an 'action' parameter — pick the action and pass parameters in 'params'.

### Common Operations

**Create a rule:**
\`storelayer_project\` action: \`add_rule\`, params: \`{ name, conditions, actions, resources }\`

**Test conditions:**
\`storelayer_project\` action: \`test_conditions\`, params: \`{ conditions: { conditions: [...], combinator: "AND" }, context: { event: {...} } }\`

**Get wallet balance:**
\`storelayer_wallet\` action: \`get_balance\`, user_id: \`"user_123"\`

**Create a promotion:**
\`storelayer_promotions\` action: \`create_promotion\`, params: \`{ name, conditions, applicationMethod, status }\`

**Evaluate promotions on a cart:**
\`storelayer_promotions\` action: \`evaluate_cart\`, params: \`{ cart: { items: [...] }, userId, couponCodes }\`

### Key Concepts
- **Resources**: Data sources for rules (event, user, wallet, store, http, database)
- **Rules**: Conditions + actions triggered by events (e.g., "purchase > $100 → reward 500 points")
- **Promotions**: Discount campaigns with conditions, codes, and validity periods
- **Wallet**: Points/currency ledger per user. Access in conditions via \`{{ $('wallet').balances.<assetType> }}\`
- **Conditions**: Expressions like \`{{ $('event').amount }}\` > 100

When creating rules/promotions, always:
1. Ask the user what they want to achieve in plain language
2. Translate to Storelayer's condition/action format
3. Show what you'll create before doing it
4. Test the rule/promotion after creating it
`;

    return { systemPrompt: event.systemPrompt + extra };
  });

  // -----------------------------------------------------------------------
  // /storelayer command — quick setup & status
  // -----------------------------------------------------------------------

  pi.registerCommand("storelayer", {
    description: "Show Storelayer connection status and configuration",
    handler: async (_args, ctx) => {
      configRef.current = loadConfig(ctx.cwd);
      if (configRef.current) {
        ctx.ui.notify(
          `🏪 Connected to ${configRef.current.apiUrl}${configRef.current.projectId ? ` (project: ${configRef.current.projectId})` : ""}`,
          "info"
        );
      } else {
        ctx.ui.notify(
          "❌ Not configured. Set STORELAYER_API_KEY in .env, environment, or .storelayer.json",
          "error"
        );
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Fallback tool (when manifest fetch fails)
// ---------------------------------------------------------------------------

function registerFallbackTool(
  pi: ExtensionAPI,
  configRef: { current: StorelayerConfig | null },
) {
  pi.registerTool({
    name: "storelayer_api",
    label: "Storelayer API",
    description: "Call any Storelayer API endpoint directly. Use when auto-generated tools are unavailable.",
    promptSnippet: "Call Storelayer API (GET/POST/PUT/PATCH/DELETE any endpoint)",
    promptGuidelines: [
      "Common endpoints: /projects/{pid}/rules, /projects/{pid}/promotions, /projects/{pid}/users",
      "Rule execution: POST /projects/{pid}/rules/execute with { userId, context: { event: {...} } }",
      "Rule evaluation: POST /projects/{pid}/rules/evaluate with { context: { event: {...} } }",
    ],
    parameters: Type.Object({
      method: StringEnum(["GET", "POST", "PUT", "PATCH", "DELETE"] as const, {
        description: "HTTP method",
      }),
      endpoint: Type.String({
        description: 'API endpoint path, e.g. "/projects/{projectId}/rules"',
      }),
      body: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Request body (for POST/PUT/PATCH)",
        })
      ),
    }),

    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cfg = ensureConfig(configRef.current, ctx);
      if (!cfg) return notConfigured();

      const result = await callApi(cfg, params.method, params.endpoint, params.body);

      if (!result.ok) {
        return errorResult(`API Error (${result.status}): ${result.error}`, { error: result.error, status: result.status });
      }

      return successResult(`${params.method} ${params.endpoint}`, result.data);
    },

    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("storelayer_api ")) +
        theme.fg("accent", `${args.method} `) +
        theme.fg("muted", args.endpoint),
        0, 0
      );
    },
  });
}
