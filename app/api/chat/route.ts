import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  SYSTEM_PROMPT,
  briefFor,
  checkProposal,
  describeAmbiguity,
  resolveTarget,
  type Proposal,
} from "@/lib/chat-intent";
import { getConfig, getFieldSpec, listConfigs } from "@/lib/config-repository";
import { SERVICES, SERVICE_KEYS } from "@/lib/services";
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

const MODEL = process.env.HALO_CHAT_MODEL ?? "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

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
};

function reply(body: ChatReply, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** The model is asked for JSON; this survives it wrapping the JSON in prose anyway. */
export function parseModelJson(text: string): { changes?: unknown; summary?: unknown; question?: unknown } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
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

  const target = resolveTarget(prompt, rows as never, (service) => SERVICES[service].idColumn);
  if (target.kind === "none") {
    return reply({
      message:
        "Which project? Name its code — for example “CFC's WBGT alerts shouldn't go out on Sundays”. " +
        "One project at a time.",
    });
  }
  if (target.kind === "many") {
    return reply({ message: describeAmbiguity(target.candidates, (key) => SERVICES[key].label) });
  }

  const { service, projectCode, rowId } = target.target;
  const [spec, row] = await Promise.all([getFieldSpec(service), getConfig(service, rowId)]);
  if (!row) return reply({ message: `${projectCode} is no longer there — try refreshing.` });

  const columns = briefFor(spec, row);

  // Checked HERE rather than at the top: resolving which project a sentence is
  // about needs no model, so "which project?" and "that could be either of
  // these" are answered even with no key configured. Only the mapping step
  // needs one.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return reply({
      message:
        `Understood ${projectCode} (${SERVICES[service].label}), but ANTHROPIC_API_KEY is not set on the server, ` +
        "so the change itself cannot be worked out. Use the editor directly.",
    });
  }

  let text = "";
  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              `Service: ${SERVICES[service].label}`,
              `Project: ${projectCode}`,
              "",
              "Editable columns:",
              JSON.stringify(columns, null, 1),
              "",
              `Request: ${prompt}`,
            ].join("\n"),
          },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      return reply({ message: `The model returned ${response.status}. ${detail.slice(0, 300)}` }, 502);
    }
    const body = (await response.json()) as { content?: { type: string; text?: string }[] };
    text = (body.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
  } catch (error) {
    return reply({ message: `Could not reach the model: ${error instanceof Error ? error.message : error}` }, 502);
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
