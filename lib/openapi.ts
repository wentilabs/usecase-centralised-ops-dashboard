import { SERVICE_KEYS } from "./services";
import { JOB_KEYS } from "./jobs";

/**
 * The OpenAPI description of HALO's API, and the single source of truth for it.
 *
 * Authored here rather than in a `.yaml` file, and rather than generated from
 * the route handlers, for two reasons. Next's App Router has no central router
 * object to introspect — routes are files exporting `GET`/`POST` — so anything
 * claiming to generate a spec from it is really reading comments. And authoring
 * in TypeScript means the document is type-checked, and `tests/openapi.test.ts`
 * can import it directly to check it against the handlers that actually exist.
 *
 * `/openapi.json` and `/openapi.yaml` both render this object, and
 * `scripts/build-openapi.mjs` writes the committed `openapi.yaml` from it. A
 * test fails if that file drifts.
 *
 * Written for an agent, which means the descriptions are the interface. An
 * agent framework turns `operationId` into a tool name and `description` into
 * the tool's entire understanding of what calling it does — so every write here
 * says what changes in the real world, not merely what the endpoint returns.
 */

export const OPENAPI_VERSION = "3.1.0";
export const API_VERSION = "0.1.0";

const problem = {
  type: "object",
  description: "RFC 9457 problem detail. Branch on `title`, not on prose.",
  properties: {
    error: { type: "string", description: "Human-readable explanation of what went wrong." },
  },
  required: ["error"],
} as const;

/** Every error an authenticated route can return, shared so agents learn it once. */
const errorResponses = {
  "400": { description: "The request was understood but is not valid.", content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } } },
  "401": { description: "No usable credential. Send `Authorization: Bearer halo_…`.", content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } } },
  "403": { description: "Authenticated, but the credential lacks the scope this operation needs.", content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } } },
  "404": { description: "No such service, project, job or export.", content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } } },
} as const;

const projectConfigRow = {
  type: "object",
  additionalProperties: true,
  description:
    "One project's live configuration. Columns vary by service and are discovered from the database at runtime — call `getSchema` to learn the shape rather than assuming it.",
} as const;

export const openapiDocument = {
  openapi: OPENAPI_VERSION,
  info: {
    title: "HALO — Centralised Services control surface",
    version: API_VERSION,
    summary: "Read and change the live configuration of six centralised alerting services.",
    description: [
      "HALO is the configuration control surface for the WBGT, Noise, Haze, Lightning, Ailytics and",
      "Subcon Activities services. Every service reads its configuration from Postgres on a cron, so a",
      "write through this API changes real behaviour on the next tick — messages sent to real WhatsApp",
      "groups on real construction sites.",
      "",
      "**There is no staging.** Treat every project as production. Where a project has `enabled = false`",
      "it is safe to experiment with; anything else is live.",
      "",
      "The column set for each service is not fixed in this document. It is introspected from the live",
      "database, so new columns appear without a release. Call `getSchema` first and work from what it",
      "returns, including each field's widget, options, default and help text.",
      "",
      "**Agents:** the same operations are available over MCP at `/api/mcp` (Streamable HTTP, JSON only),",
      "with tools derived from this document — one tool per `operationId`, carrying safety annotations.",
      "That is usually the better surface; this one is the contract it is generated from.",
    ].join("\n"),
    contact: { name: "Wenti Labs" },
  },
  // The deployed hostname is not recorded anywhere in this repo — DEPLOYMENT.md
  // itself writes `https://<app>.amplifyapp.com`. Rather than invent one, the
  // production entry appears only when HALO_PUBLIC_URL is set. A guessed server
  // URL in a machine-readable contract is worse than a missing one: an agent
  // resolves it and fails somewhere confusing.
  servers: [
    ...(process.env.HALO_PUBLIC_URL
      ? [{ url: process.env.HALO_PUBLIC_URL.replace(/\/+$/, ""), description: "Production" }]
      : []),
    { url: "http://localhost:5178", description: "Local development" },
  ],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "discovery", description: "What exists, and what shape it has. Start here." },
    { name: "configuration", description: "Read and change project configuration." },
    { name: "operations", description: "Trigger work on the alerting services. These have real-world effects." },
    { name: "onboarding", description: "Create a new project." },
  ],
  paths: {
    "/api/session": {
      get: {
        operationId: "getSession",
        tags: ["discovery"],
        summary: "Who am I, and what may I do",
        description:
          "Resolves the caller's credential and reports the scopes it carries. Call this first to confirm a token works and to discover whether writes are permitted, rather than discovering it from a 403 mid-task.",
        responses: {
          "200": {
            description: "The resolved identity.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    allowed: { type: "boolean" },
                    canEdit: { type: "boolean", description: "True when the credential may change configuration." },
                    actor: { type: "string", description: "Recorded against every change this credential makes. An agent appears as `agent:<name>`." },
                    kind: { type: "string", enum: ["session", "token", "local-bypass", "none"] },
                    scopes: { type: "array", items: { type: "string", enum: ["read", "write", "jobs"] } },
                  },
                },
              },
            },
          },
          "401": errorResponses["401"],
        },
      },
    },
    "/api/schema": {
      get: {
        operationId: "getSchema",
        tags: ["discovery"],
        summary: "The editable field spec for every service",
        description:
          "Returns, per service, every column with its widget, options, default, help text and group. Introspected from the live database, so this is the authoritative shape — a column added by a migration appears here without a release. An agent should read this before writing anything, because a value that fails a column's CHECK is rejected by Postgres rather than by HALO.",
        responses: {
          "200": {
            description: "Field specs keyed by service.",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
          "401": errorResponses["401"],
        },
      },
    },
    "/api/schema/reload": {
      post: {
        operationId: "reloadSchema",
        tags: ["discovery"],
        summary: "Discard the cached field spec",
        description:
          "Forces the next `getSchema` to re-introspect the database. Only needed immediately after a migration; the cache is otherwise harmless. Changes no data.",
        responses: {
          "200": { description: "Cache cleared.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "401": errorResponses["401"],
          "403": errorResponses["403"],
        },
      },
    },
    "/api/chat": {
      post: {
        operationId: "proposeConfigChange",
        tags: ["configuration"],
        summary: "Turn one sentence into a proposed change, a bulk change, or an onboarding plan",
        description:
          "PROPOSES ONLY — writes nothing, on every path. Which rows a sentence affects is resolved HERE, in code, from the project codes this dashboard holds; the model is only ever asked what to do to them, never which they are. Returns exactly one of four shapes, and the response key says which:\n\n" +
          "- `proposal` — one project. Apply with `updateProjectConfig`.\n" +
          "- `batch` — several projects, each with its own change set. Apply one `updateProjectConfig` per entry; there is no bulk write endpoint, so each keeps its own validation, optimistic concurrency and audit row.\n" +
          "- `onboard` — projects to CREATE. Apply one `createProject` per entry in `services[].ready`, passing that entry's `values` as the `draft`.\n" +
          "- `message` — a question or a refusal, when there is nothing to propose.\n\n" +
          "The onboarding path consults no model at all: the company, the target services and the missing sites are all decided in code, so no project code can be invented. It counts SITES rather than project codes, using the cross-service identity map — the estate spells nine sites differently per service, so onboarding by code would create duplicates. Entries under `services[].blocked` carry `problems` and must not be sent to `createProject`; they are listed rather than dropped because \"34 of 36 need a Safety workbook id\" is the answer to the request. `services[].alreadyThere` reports sites present under a different code.\n\n" +
          "Requires an editor session, and `ANTHROPIC_API_KEY` for the two model-backed paths. An agent that already reads `getSchema` should call `updateProjectConfig` directly rather than paying for a model round-trip; the onboarding path is worth calling even so, because the site-matching it does is not reproducible from the schema alone.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  prompt: {
                    type: "string",
                    description:
                      "One request, of any length — there is no cap, and a well-specified onboarding request often runs to several paragraphs, all of which is read. Name the project and the outcome for a single change (\"CFC's WBGT alerts shouldn't go out on Sundays\"); name a company or \"all projects\" for a bulk one (\"remove the WL coordination groups from every project\"); or say onboard/create/set up/register with a target service for an onboarding plan (\"onboard every Wohhup site into issue chaser and subcon\"). The word \"add\" is deliberately NOT read as onboarding — it is the verb for editing far more often.",
                  },
                },
                required: ["prompt"],
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Exactly one of `proposal`, `batch`, `onboard` or `message`. Nothing has been written; each carries the full set of rows it would affect, so the list IS the change rather than a count to be trusted.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string", description: "A question or refusal. Present when nothing can be proposed." },
                    proposal: { type: "object", additionalProperties: true, description: "One project's change set." },
                    batch: { type: "object", additionalProperties: true, description: "Several projects, each with its own change set." },
                    onboard: {
                      type: "object",
                      description: "Projects to create, grouped by target service.",
                      properties: {
                        summary: { type: "string" },
                        company: { type: ["string", "null"], description: "The company the request scoped to, if any." },
                        services: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              service: { type: "string" },
                              label: { type: "string" },
                              ready: {
                                type: "array",
                                description: "Creatable as they stand. Send each `values` to createProject as the `draft`.",
                                items: {
                                  type: "object",
                                  properties: {
                                    projectCode: { type: "string" },
                                    values: { type: "object", additionalProperties: { type: "string" } },
                                    knownAs: {
                                      type: "array",
                                      items: { type: "string" },
                                      description: "What this site is already called in other services.",
                                    },
                                  },
                                },
                              },
                              blocked: {
                                type: "array",
                                description: "Short a required field. Do NOT send these to createProject; `problems` says what is missing.",
                                items: {
                                  type: "object",
                                  properties: {
                                    projectCode: { type: "string" },
                                    values: { type: "object", additionalProperties: { type: "string" } },
                                    knownAs: { type: "array", items: { type: "string" } },
                                    problems: { type: "array", items: { type: "string" } },
                                  },
                                },
                              },
                              alreadyThere: {
                                type: "array",
                                description: "Sites already onboarded here, possibly under a different code.",
                                items: {
                                  type: "object",
                                  properties: {
                                    projectCode: { type: "string", description: "The canonical site code." },
                                    existingAs: { type: "string", description: "The code this service actually uses." },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  additionalProperties: true,
                },
              },
            },
          },
          "400": errorResponses["400"],
          "401": errorResponses["401"],
          "403": errorResponses["403"],
          "502": {
            description: "The model could not be reached, or did not answer usefully.",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
        },
      },
    },
    "/api/lightning/detections": {
      get: {
        operationId: "listLightningDetections",
        tags: ["configuration"],
        summary: "Lightning detections in a published-time window",
        description:
          "Every NEA lightning detection published between `at - window` and `at`, island-wide and beyond — the ingest path applies no geographic filter, so an empty result means NEA reported nothing rather than that anything was discarded. Filtered on publish time, not strike time, because that is what the service could have acted on; each row carries both so the lag is visible. Ordered by publish time descending and capped by `limit` (default 500) and by PostgREST's own 1000-row ceiling, with `total` reporting the size of the whole match — compare the two before treating a result as complete. Pass `bbox` to narrow to a viewport and see more of a busy window. Reads only.",
        parameters: [
          {
            name: "at",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description: "End of the window, epoch milliseconds. Defaults to now.",
          },
          {
            name: "window",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["15m", "1h", "3h"] },
            description: "How far back from `at` to look. Defaults to 1h.",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer" },
            description:
              "How many rows to return, default 500. PostgREST caps any result at 1000, so a larger value is accepted but not honoured — compare `total` against the rows returned rather than trusting the limit.",
          },
          {
            name: "types",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Comma-separated detection types to keep, G and/or C. Restricting to the types a project's tiers actually count is what keeps a busy hour under the row cap; a storm is overwhelmingly intra-cloud.",
          },
          {
            name: "bbox",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "south,west,north,east — restricts the result to a viewport.",
          },
        ],
        responses: {
          "200": {
            description: "The detections, plus the window and what was truncated.",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
          "400": errorResponses["400"],
          "401": errorResponses["401"],
          "502": {
            description: "The detections could not be read.",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
        },
      },
    },
    "/api/projects": {
      get: {
        operationId: "listProjects",
        tags: ["configuration"],
        summary: "Every project across all six services",
        description:
          "Returns all configuration rows, keyed by service, plus a `fetchedAt` timestamp. This is a snapshot: a change made in Supabase directly is visible immediately here, but any copy you hold is stale from the moment you take it.",
        responses: {
          "200": {
            description: "All projects, keyed by service key.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    fetchedAt: { type: "string", format: "date-time" },
                    meta: { type: "object", additionalProperties: true },
                  },
                  additionalProperties: { type: "array", items: { $ref: "#/components/schemas/ProjectConfigRow" } },
                },
              },
            },
          },
          "401": errorResponses["401"],
        },
      },
    },
    "/api/config/{service}/{rowId}": {
      patch: {
        operationId: "updateProjectConfig",
        tags: ["configuration"],
        summary: "Change one project's configuration",
        description: [
          "Applies a partial update to one project row. **This changes production behaviour** — the owning",
          "service picks the new values up on its next cron tick.",
          "",
          "Every change is validated against the live schema before it reaches the database, and recorded in",
          "`ops.config_audit` against the caller's identity. Supply a `note` saying why; it is stored with the",
          "change and is the only context a later reader gets.",
          "",
          "Pass `baseUpdatedAt` from the row you read. The write is refused with 409 if the row changed in the",
          "meantime, rather than silently overwriting someone else's edit.",
        ].join("\n"),
        parameters: [
          { name: "service", in: "path", required: true, schema: { type: "string", enum: [...SERVICE_KEYS] } },
          { name: "rowId", in: "path", required: true, schema: { type: "string" }, description: "`project_code` for most services; the row `id` for Ailytics and Subcon Activities." },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  changes: { type: "object", additionalProperties: true, description: "Column name to new value. Only columns the schema marks editable are accepted." },
                  baseUpdatedAt: { type: ["string", "null"], format: "date-time", description: "The `updated_at` of the row you read. Omit only if you accept overwriting a concurrent change." },
                  note: { type: "string", maxLength: 500, description: "Why. Stored in the audit trail." },
                },
                required: ["changes"],
              },
            },
          },
        },
        responses: {
          "200": { description: "Applied. Returns the stored row and the effective diff.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "400": errorResponses["400"],
          "401": errorResponses["401"],
          "403": errorResponses["403"],
          "404": errorResponses["404"],
          "409": { description: "The row changed since `baseUpdatedAt`. Re-read and re-apply.", content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } } },
        },
      },
    },
    "/api/audit": {
      get: {
        operationId: "listAudit",
        tags: ["configuration"],
        summary: "History of configuration changes",
        description: [
          "Every change to any config table, newest first, written by a Postgres trigger rather than by HALO —",
          "so a change made directly in Supabase is captured just as faithfully as one made here.",
          "",
          "`actor_email` is filled in only for changes made through HALO. A row without one was made outside it,",
          "and **the database does not record who**. Note also that many such rows are the services writing their",
          "own runtime state, not people.",
          "",
          "Only updates are recorded. Row creation and deletion are not.",
        ].join("\n"),
        parameters: [
          { name: "service", in: "query", schema: { type: "string", enum: [...SERVICE_KEYS] }, description: "Restrict to one service's config table." },
          { name: "project", in: "query", schema: { type: "string" }, description: "Restrict to one project — `project_code`, or the row id for Ailytics and Subcon." },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 200 } },
        ],
        responses: {
          "200": { description: "Audit entries, newest first.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "401": errorResponses["401"],
        },
      },
    },
    "/api/group-names": {
      get: {
        operationId: "listGroupNames",
        tags: ["discovery"],
        summary: "WhatsApp chat id to human group name",
        description:
          "Resolves the `120363…@g.us` identifiers that appear throughout the configuration into readable group names. Pass `refresh=1` to re-read them from the listener, which is slow and rarely necessary.",
        parameters: [{ name: "refresh", in: "query", schema: { type: "string", enum: ["1"] } }],
        responses: {
          "200": { description: "Chat id to name.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "401": errorResponses["401"],
        },
      },
    },
    "/api/noise-meters": {
      get: {
        operationId: "listNoiseMeters",
        tags: ["discovery"],
        summary: "Noise meters for one project",
        description:
          "Resolves a noise project's meter RecIDs to their location names. Needed to interpret or set `noise_meters_included`, which stores RecIDs rather than names.",
        parameters: [
          { name: "project", in: "query", required: true, schema: { type: "string" }, description: "Project code." },
        ],
        responses: {
          "200": { description: "Meters for the project.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "401": errorResponses["401"],
        },
      },
    },
    "/api/jobs/{job}": {
      post: {
        operationId: "runJob",
        tags: ["operations"],
        summary: "Trigger a job on an alerting service",
        description: [
          "Runs one job against one project for a date range. **Requires the `jobs` scope, which `write` does",
          "not confer.**",
          "",
          "These have real-world effects that differ per job. `wbgt-scrape` logs into CloudLynx and drives a",
          "browser session that can run for minutes. The sheet jobs write to Google Sheets. Read the job's",
          "`description` in `listJobs` before calling it, and prefer a narrow date range.",
          "",
          "The precondition is re-checked server-side, because every one of these jobs reports success while",
          "doing nothing when it is unmet.",
        ].join("\n"),
        parameters: [{ name: "job", in: "path", required: true, schema: { type: "string", enum: [...JOB_KEYS] } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  projectCode: { type: "string" },
                  startDate: { type: "string", format: "date", description: "YYYY-MM-DD, inclusive." },
                  endDate: { type: "string", format: "date", description: "YYYY-MM-DD, inclusive." },
                  flags: { type: "object", additionalProperties: { type: "boolean" }, description: "Only flags the job declares are forwarded." },
                },
                required: ["projectCode", "startDate", "endDate"],
              },
            },
          },
        },
        responses: {
          "200": { description: "The service's own response, passed through.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "400": errorResponses["400"],
          "401": errorResponses["401"],
          "403": errorResponses["403"],
          "404": errorResponses["404"],
          "503": { description: "The service's base URL is not configured on HALO.", content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } } },
        },
      },
    },
    "/api/exports/{export}": {
      post: {
        operationId: "runExport",
        tags: ["operations"],
        summary: "Export a monitoring record as PDF or xlsx",
        description:
          "Returns a file, or a JSON blocker list explaining why it cannot. Read-only: nothing is written and no message is sent. Send `preflight: true` to get the blockers and the available tabs without producing a file.",
        parameters: [
          { name: "export", in: "path", required: true, schema: { type: "string" } },
          { name: "preflight", in: "query", schema: { type: "string", enum: ["1"] }, description: "Check readiness only." },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  projectCode: { type: "string" },
                  tab: { type: "string", description: "Worksheet name, where the export targets one tab." },
                  format: { type: "string", enum: ["pdf", "xlsx"] },
                  scope: { type: "string", enum: ["workbook", "tab"] },
                },
                required: ["projectCode"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "The file, or a readiness report when blocked.",
            content: {
              "application/pdf": { schema: { type: "string", format: "binary" } },
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } },
              "application/json": { schema: { type: "object", additionalProperties: true } },
            },
          },
          "401": errorResponses["401"],
          "404": errorResponses["404"],
        },
      },
    },
    "/api/onboard/{service}": {
      get: {
        operationId: "getOnboardingRequirements",
        tags: ["onboarding"],
        summary: "What creating a project for this service needs",
        description:
          "Reports the prefilled defaults the server can supply, which environment-backed defaults are missing, and whether any prerequisite database function is installed. Call before `createProject` — WBGT cannot be onboarded at all until its readings-table function exists.",
        parameters: [{ name: "service", in: "path", required: true, schema: { type: "string", enum: [...SERVICE_KEYS] } }],
        responses: {
          "200": { description: "Requirements and defaults.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "401": errorResponses["401"],
          "404": { description: "This service has no onboarding flow.", content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } } },
        },
      },
      post: {
        operationId: "createProject",
        tags: ["onboarding"],
        summary: "Create a project",
        description: [
          "Creates a new project, **always disabled**. `enabled` cannot be set here; it is turned on afterwards",
          "through `updateProjectConfig` once the project has been verified.",
          "",
          "What gets created varies. Haze and Lightning are a single row. Ailytics is a row whose blank NOT NULL",
          "columns are stored as empty strings. WBGT creates a per-project readings table first, then the config",
          "row, then a sensor row.",
          "",
          "Some steps are outside HALO entirely — sharing a Google Sheet, deploying an adapter, matching a",
          "CloudLynx sensor label. The response lists them, and a project is not working until they are done.",
          "",
          "Note that row creation is **not** recorded in the audit trail; only later updates are.",
        ].join("\n"),
        parameters: [{ name: "service", in: "path", required: true, schema: { type: "string", enum: [...SERVICE_KEYS] } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  draft: { type: "object", additionalProperties: { type: "string" }, description: "Field values, keyed by column. Call `getOnboardingRequirements` for the field list." },
                },
                required: ["draft"],
              },
            },
          },
        },
        responses: {
          "200": { description: "Created. Lists what was created and what remains to be done by hand.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "400": errorResponses["400"],
          "401": errorResponses["401"],
          "403": errorResponses["403"],
          "503": { description: "A prerequisite database function is not installed.", content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } } },
        },
      },
    },
    "/api/onboard/geocode": {
      get: {
        operationId: "geocodeAddress",
        tags: ["onboarding"],
        summary: "Singapore address or postal code to coordinates",
        description:
          "Looks a location up through OneMap and returns candidates with coordinates. Each carries `valid`, which is false when the result falls outside the service area that Haze and Lightning enforce with a CHECK constraint — do not use an invalid candidate.",
        parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" }, description: "Postal code or address." }],
        responses: {
          "200": { description: "Ranked candidates.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "400": errorResponses["400"],
          "401": errorResponses["401"],
          "504": { description: "OneMap did not respond in time.", content: { "application/json": { schema: { $ref: "#/components/schemas/Problem" } } } },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: [
          "A token minted by `scripts/mint-api-token.mjs`, sent as `Authorization: Bearer halo_…`.",
          "",
          "Scopes are additive and **not** hierarchical: `read` permits reads, `write` permits configuration",
          "changes, `jobs` permits triggering jobs. Holding `write` does not confer `read`, and neither confers",
          "`jobs`. Call `getSession` to see what a token actually carries.",
          "",
          "Every change a token makes is attributed to `agent:<name>` in the audit trail.",
        ].join("\n"),
      },
    },
    schemas: {
      Problem: problem,
      ProjectConfigRow: projectConfigRow,
    },
  },
} as const;

export type OpenApiDocument = typeof openapiDocument;
