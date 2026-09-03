import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  SYSTEM_PROMPT,
  briefFor,
  checkProposal,
  describeAmbiguity,
  parseModelJson,
  resolveTarget,
  type ChatTarget,
  type Proposal,
} from "@/lib/chat-intent";
import {
  BULK_SYSTEM_PROMPT,
  applyToAll,
  defaultsFor,
  describeScope,
  matchGroupNames,
  parseBulkOp,
  removeGroupsFrom,
  resolveScope,
  type RowEdit,
  type Scope,
} from "@/lib/chat-scope";
import { planOnboarding, saysOnboard } from "@/lib/chat-onboard";
import { clusterProjects, type ServiceRow } from "@/lib/project-identity";
import { getGroupNames } from "@/lib/group-names";
import { chatIdsIn } from "@/lib/card-summary";
import {
  buildRequest,
  chooseProvider,
  extractText,
  fallbackRequest,
  shouldFallBack,
} from "@/lib/chat-provider";
import { getConfig, getFieldSpec, listConfigs } from "@/lib/config-repository";
import { SERVICES, SERVICE_KEYS, type ProjectConfigRow, type ServiceKey } from "@/lib/services";
import { getDashboardSession } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Turn one sentence into a proposed change for one project.
 *
 * This route PROPOSES. It never writes: the answer opens the ordinary editor
 * with those fields already changed, and the person still reads the diff and
 * presses save, which goes through `PATCH /api/config/...` with its own
 * validation, its own optimistic-concurrency check and its own audit row. The
 * chat is a faster way to reach that confirmation, not a way around it.
 *
 * The project is resolved HERE, deterministically, from the codes HALO already
 * holds — see `lib/chat-intent.ts` for why that is not the model's job. The model
 * is given one service's columns, with the same labels and help text the editor
 * shows a person, and asked for JSON.
 */

type ChatReply = {
  /** What to say back when there is nothing to propose. */
  message?: string;
  /** A proposal the client should open the editor with. */
  proposal?: {
    service: string;
    serviceLabel: string;
    projectCode: string;
    rowId: string;
    changes: Record<string, unknown>;
    summary: string;
    /** Columns the model asked for that this refused, with the reason. */
    rejected: { column: string; reason: string }[];
  };
  /**
   * A change covering several projects.
   *
   * Sent instead of `proposal` when the sentence resolved to more than one row.
   * It carries every row that will change, so the review list the operator reads
   * is the exact set of writes — not a count to be trusted.
   */
  batch?: {
    scope: string;
    /** How many projects the scope covers, which is not how many will change. */
    inScope: number;
    summary: string;
    /** For a group removal: which groups matched the phrase, for confirmation. */
    matchedGroups?: { chatId: string; name: string; score: number }[];
    edits: {
      service: string;
      serviceLabel: string;
      projectCode: string;
      rowId: string;
      changes: Record<string, unknown>;
      detail?: string;
    }[];
  };
  /**
   * Projects to CREATE, sent instead of the others when the sentence asks for
   * onboarding.
   *
   * Every row is listed — the ones that can be created and the ones short a
   * required field — because "34 of 36 need a Safety workbook id" is the answer
   * to the request, and creating only the two that happen to be complete would
   * answer a question nobody asked. Nothing here is written until the operator
   * confirms the list.
   */
  onboard?: {
    summary: string;
    company: string | null;
    services: {
      service: string;
      label: string;
      ready: { projectCode: string; values: Record<string, string>; knownAs: string[] }[];
      blocked: {
        projectCode: string;
        values: Record<string, string>;
        knownAs: string[];
        problems: string[];
      }[];
      alreadyThere: { projectCode: string; existingAs: string }[];
    }[];
  };
};

function reply(body: ChatReply, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}


/**
 * One HTTP call to the model. Hoisted so the single-project and bulk paths share
 * it rather than each keeping a copy that could drift on retry behaviour.
 */
async function askModel(
  choice: Parameters<typeof buildRequest>[0],
  turn: { system: string; user: string },
  override?: ReturnType<typeof buildRequest> | null,
) {
  const request = override ?? buildRequest(choice, turn);
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    cache: "no-store",
  });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

/**
 * Ask the model what to do to a set of rows, then do it in code.
 *
 * The division of labour is the same as the single-project path and matters more
 * here: the model classifies the request and supplies values or a phrase, and
 * this function decides which rows and which chat ids. Nothing the model says
 * selects a project or a group.
 *
 * A `set` is refused across several services on purpose. The same outcome is
 * different columns on different services — muting public holidays is
 * `remove_ph_notifications` on some and absent on others — so a cross-service
 * `set` would need per-service column mapping that nothing here validates. The
 * operator is asked to name a service instead. Group removal and defaults have
 * no such problem: both resolve their columns per service, in code.
 */
async function bulkReply({
  prompt,
  scope,
  rows,
}: {
  prompt: string;
  scope: Extract<Scope, { targets: ChatTarget[] }>;
  rows: Partial<Record<ServiceKey, ProjectConfigRow[]>>;
}) {
  const services: ServiceKey[] = [...new Set(scope.targets.map((entry) => entry.service))];
  const scopeLine = describeScope(scope, (key) => SERVICES[key].label);
  const rowFor = ({ service, projectCode }: ChatTarget) =>
    (rows[service] ?? []).find((row) => String(row.project_code ?? "") === projectCode);

  const choice = chooseProvider(process.env);
  if (!choice.provider) {
    return reply({ message: `Understood ${scopeLine}, but ${choice.reason}, so the change cannot be worked out.` });
  }

  // Columns are offered to the model only when the scope is one service, since
  // that is the only case where `set` is allowed.
  let columnBlock = "Several services are in scope, so no column list is given: `set` is not available here.";
  if (services.length === 1) {
    const service = services[0];
    const spec = await getFieldSpec(service);
    const sample = rowFor(scope.targets[0]);
    if (sample) {
      columnBlock = ["Editable columns (values shown are one project's, as an example):",
        JSON.stringify(briefFor(service, spec, sample), null, 1)].join("\n");
    }
  }

  const turn = {
    system: BULK_SYSTEM_PROMPT,
    user: [
      `Scope (already decided, ${scope.targets.length} projects): ${scopeLine}`,
      `Services in scope: ${services.map((key) => SERVICES[key].label).join(", ")}`,
      "",
      columnBlock,
      "",
      `Request: ${prompt}`,
    ].join("\n"),
  };

  let text = "";
  try {
    let result = await askModel(choice, turn);
    if (!result.ok && shouldFallBack(result.status, result.text)) {
      const second = fallbackRequest(choice, turn);
      if (second) result = await askModel(choice, turn, second);
    }
    if (!result.ok) {
      return reply({ message: `${choice.model} returned ${result.status}. ${result.text.slice(0, 300)}` }, 502);
    }
    text = extractText(JSON.parse(result.text));
    if (!text) return reply({ message: `${choice.model} answered with nothing this could read.` }, 502);
  } catch (error) {
    return reply({ message: `Could not reach ${choice.model}: ${error instanceof Error ? error.message : error}` }, 502);
  }

  const op = parseBulkOp(parseModelJson(text) as Record<string, unknown> | null);
  if (!op) return reply({ message: "The model did not answer in a shape this could use. Try rewording it." });
  if (op.kind === "question") return reply({ message: op.question });

  let edits: RowEdit[] = [];
  let matchedGroups: { chatId: string; name: string; score: number }[] | undefined;

  if (op.kind === "remove-groups") {
    // The alias store is the only source for what a group is called, so a phrase
    // is matched against it rather than against anything the model produced.
    const aliases = await getGroupNames(chatIdsIn(Object.values(rows).flat() as ProjectConfigRow[]));
    matchedGroups = matchGroupNames(op.phrase, aliases.map);
    if (!matchedGroups.length) {
      return reply({ message: `No delivery group matches “${op.phrase}”. Check the name, or open Chat aliases to refresh them.` });
    }
    edits = removeGroupsFrom(
      scope.targets,
      rowFor,
      matchedGroups.map((match) => match.chatId),
      (chatId) => aliases.map[chatId] || chatId,
    );
  } else if (op.kind === "defaults") {
    for (const service of services) {
      const spec = await getFieldSpec(service);
      for (const target of scope.targets.filter((entry) => entry.service === service)) {
        const row = rowFor(target);
        if (!row) continue;
        const changes = defaultsFor(spec.fields as never, row);
        if (Object.keys(changes).length) edits.push({ ...target, changes });
      }
    }
  } else {
    if (services.length > 1) {
      return reply({
        message:
          `That change covers ${services.map((key) => SERVICES[key].label).join(", ")}, and the columns differ ` +
          "between them. Name one service — for example “all noise projects…”.",
      });
    }
    const spec = await getFieldSpec(services[0]);
    // Validated against the spec once, using one row, before being applied to
    // all of them — a bad column name should fail as a sentence, not 30 times.
    const probe = rowFor(scope.targets[0]);
    if (probe) {
      const { problems } = checkProposal(spec, probe, { changes: op.changes, summary: op.summary });
      if (problems.length && !Object.keys(op.changes).some((column) => spec.fields[column])) {
        return reply({
          message: `No change to propose. It asked for ${problems
            .map((problem) => `${problem.column} (${problem.reason})`)
            .join(", ")}.`,
        });
      }
    }
    edits = applyToAll(scope.targets, rowFor, op.changes);
  }

  if (!edits.length) {
    return reply({ message: `Nothing to change — every project in ${scopeLine} already reads that way.` });
  }

  return reply({
    batch: {
      scope: scopeLine,
      inScope: scope.targets.length,
      summary: op.summary || "Proposed bulk change",
      ...(matchedGroups ? { matchedGroups } : {}),
      edits: edits.map((edit) => ({
        service: edit.service,
        serviceLabel: SERVICES[edit.service].label,
        projectCode: edit.projectCode,
        rowId: edit.rowId,
        changes: edit.changes,
        ...(edit.detail ? { detail: edit.detail } : {}),
      })),
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await getDashboardSession();
  if (!session.allowed) return reply({ message: "Unauthorized." }, 401);
  // Proposing a change is an editor's act even though nothing is written yet:
  // the answer is a pre-filled save dialog, and a reader who cannot save should
  // not be handed one.
  if (!session.canEdit) return reply({ message: "You have read-only access, so there is nothing to propose." }, 403);

  let prompt = "";
  try {
    const body = (await request.json()) as { prompt?: unknown };
    prompt = String(body.prompt ?? "").trim();
  } catch {
    return reply({ message: "That request was not valid JSON." }, 400);
  }
  if (!prompt) return reply({ message: "Say what you want changed, and name the project." });
  if (prompt.length > 2000) return reply({ message: "That is longer than this needs — one sentence is plenty." });

  // Which project? Deterministic, and ambiguity comes back as a question.
  const settled = await Promise.allSettled(SERVICE_KEYS.map((key) => listConfigs(key)));
  const rows: Record<string, ReturnType<typeof Object>[]> = {};
  SERVICE_KEYS.forEach((key, index) => {
    const result = settled[index];
    if (result.status === "fulfilled") rows[key] = result.value as never[];
  });

  /**
   * Onboarding is decided before scope, because scope is resolved from rows
   * that EXIST and these do not yet.
   *
   * No model is consulted on this path at all — every part of the request is
   * decidable in code, so there is no route by which a hallucinated project
   * code reaches a create. See `lib/chat-onboard.ts`.
   */
  if (saysOnboard(prompt)) {
    const serviceRows: ServiceRow[] = [];
    for (const key of SERVICE_KEYS) {
      for (const row of (rows[key] ?? []) as ProjectConfigRow[]) {
        const code = String(row.project_code ?? "").trim();
        if (code) serviceRows.push({ service: key, projectCode: code, row });
      }
    }
    const plan = planOnboarding({
      prompt,
      clusters: clusterProjects(serviceRows),
      existingFor: (service) => (rows[service] ?? []) as ProjectConfigRow[],
      env: process.env,
    });
    if (plan.kind === "question") return reply({ message: plan.question });
    const knownAs = (members: { service: ServiceKey; projectCode: string }[]) =>
      members.map((member) => `${SERVICES[member.service].label}: ${member.projectCode}`);
    return reply({
      onboard: {
        summary: plan.summary,
        company: plan.company,
        services: plan.services.map((entry) => ({
          service: entry.service,
          label: entry.label,
          ready: entry.ready.map((row) => ({
            projectCode: row.projectCode,
            values: row.values,
            knownAs: knownAs(row.knownAs),
          })),
          blocked: entry.blocked.map((row) => ({
            projectCode: row.projectCode,
            values: row.values,
            knownAs: knownAs(row.knownAs),
            problems: row.problems,
          })),
          alreadyThere: entry.alreadyThere,
        })),
      },
    });
  }

  /**
   * Scope first, then the old single-project path.
   *
   * `resolveScope` is a superset of `resolveTarget`: it returns the same set of
   * rows for a sentence naming one code, and additionally understands a company,
   * a service plus "all", and the whole estate. Both are still pure and both
   * still decide the affected rows in code — see `lib/chat-scope.ts` for why
   * that line does not move for bulk requests.
   */
  const scope = resolveScope(prompt, rows as never, (service) => SERVICES[service].idColumn);
  const distinctCodes = new Set(
    "targets" in scope ? scope.targets.map((entry) => entry.projectCode) : [],
  );

  // A bulk scope is anything covering rows this route cannot hand to the
  // single-project editor: a company, a service, the estate, or several codes
  // named at once. One code that exists under several services is NOT bulk — it
  // is the old ambiguity, and it still comes back as a question.
  const isBulk =
    scope.kind === "company" ||
    scope.kind === "service" ||
    scope.kind === "estate" ||
    (scope.kind === "projects" && distinctCodes.size > 1);

  if (isBulk && "targets" in scope) {
    return bulkReply({ prompt, scope, rows: rows as never });
  }

  const target = resolveTarget(prompt, rows as never, (service) => SERVICES[service].idColumn);
  if (target.kind === "none") {
    // A scope that refused for a stated reason says so — "name the code, or say
    // all projects" is more useful than the generic prompt below.
    if (scope.kind === "none" && scope.why) return reply({ message: scope.why });
    const named = target.hinted.map((key) => SERVICES[key].label).join(" / ");
    return reply({
      message: named
        ? `Which ${named} project? Name its code — one project at a time.`
        : "Which project? Name its code — for example “CFC's WBGT alerts shouldn't go out on Sundays”. " +
          "One project at a time.",
    });
  }
  if (target.kind === "not-in-service") {
    // Answer about the service that was actually named, not the ones that were
    // not. Listing a few of its real codes turns a dead end into a next step.
    const label = target.services.map((key) => SERVICES[key].label).join(" / ");
    const available = target.services
      .flatMap((key) => (rows[key] ?? []) as ProjectConfigRow[])
      .map((row) => String(row.project_code ?? "").trim())
      .filter(Boolean)
      .sort();
    const sample = available.slice(0, 8).join(", ");
    return reply({
      message:
        `${label} has no project called ${target.codes.join(" or ")}. ` +
        (sample ? `Its projects include ${sample}${available.length > 8 ? `, and ${available.length - 8} more` : ""}.` : ""),
    });
  }
  if (target.kind === "many") {
    return reply({ message: describeAmbiguity(target.candidates, (key) => SERVICES[key].label) });
  }

  const { service, projectCode, rowId } = target.target;
  const [spec, row] = await Promise.all([getFieldSpec(service), getConfig(service, rowId)]);
  if (!row) return reply({ message: `${projectCode} is no longer there — try refreshing.` });

  const columns = briefFor(service, spec, row);

  // Checked HERE rather than at the top: resolving which project a sentence is
  // about needs no model, so "which project?" and "that could be either of
  // these" are answered even with no key configured. Only the mapping step
  // needs one.
  const choice = chooseProvider(process.env);
  if (!choice.provider) {
    return reply({
      message:
        `Understood ${projectCode} (${SERVICES[service].label}), but ${choice.reason}, ` +
        "so the change itself cannot be worked out. Use the editor directly.",
    });
  }

  const turn = {
    system: SYSTEM_PROMPT,
    user: [
      `Service: ${SERVICES[service].label}`,
      `Project: ${projectCode}`,
      "",
      "Editable columns:",
      JSON.stringify(columns, null, 1),
      "",
      `Request: ${prompt}`,
    ].join("\n"),
  };

  let text = "";
  try {
    let result = await askModel(choice, turn);

    // Some model ids are served by one OpenAI endpoint and not the other, and
    // which is which is not knowable from the name. Trying the second is cheaper
    // than making whoever set HALO_CHAT_MODEL find out by reading an error.
    if (!result.ok && shouldFallBack(result.status, result.text)) {
      const second = fallbackRequest(choice, turn);
      if (second) result = await askModel(choice, turn, second);
    }

    if (!result.ok) {
      return reply(
        { message: `${choice.model} returned ${result.status}. ${result.text.slice(0, 300)}` },
        502,
      );
    }
    text = extractText(JSON.parse(result.text));
    if (!text) return reply({ message: `${choice.model} answered with nothing this could read.` }, 502);
  } catch (error) {
    return reply({ message: `Could not reach ${choice.model}: ${error instanceof Error ? error.message : error}` }, 502);
  }

  const parsed = parseModelJson(text);
  if (!parsed) return reply({ message: "The model did not answer in a shape this could use. Try rewording it." });
  if (typeof parsed.question === "string" && parsed.question.trim()) {
    return reply({ message: parsed.question.trim() });
  }

  const proposal: Proposal = {
    changes: (parsed.changes ?? {}) as Record<string, unknown>,
    summary: String(parsed.summary ?? "").trim(),
  };
  const { changes, problems } = checkProposal(spec, row, proposal);

  if (!Object.keys(changes).length) {
    const why = problems.length
      ? ` It asked for ${problems.map((problem) => `${problem.column} (${problem.reason})`).join(", ")}.`
      : " Nothing needed changing — the settings already say that.";
    return reply({ message: `No change to propose.${why}` });
  }

  return reply({
    proposal: {
      service,
      serviceLabel: SERVICES[service].label,
      projectCode,
      rowId,
      changes,
      summary: proposal.summary || "Proposed change",
      rejected: problems,
    },
  });
}
