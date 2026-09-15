# Feature Development Protocol

This protocol is authoritative for feature work in this repository. Repository-specific
invariants in `AGENTS.md` remain authoritative and take precedence when they are more
specific.

## The agent investigates first

A feature request normally describes a user outcome, not an implementation. Before editing
code, the agent must inspect the relevant routes, composition, application flow, domain
policy, configuration contract, migrations, invariants, and tests. Do not make an unfamiliar
developer reconstruct repository behavior or answer questions the repository can answer.

The agent must give the developer one recommended implementation, not a menu of equivalent
options. If the request conflicts with an invariant, compatibility contract, or safe failure
mode, explain the conflict and recommend the safer design before editing.

## Required feature briefing

Before implementation, report all eight items below. Clearly label what is repository-proven,
what is an engineering recommendation, and what remains an unresolved product decision.

1. **Customer behavior:** what users observe before and after the change, including failure
   and partial-success behavior.
2. **Affected invariants:** which documented invariants are involved and whether each is
   preserved, extended, or intentionally changed.
3. **Compatibility:** whether the feature is additive or changes an existing route, payload,
   message, schedule, authentication mode, configuration meaning, or other contract.
4. **Persistence:** whether it needs a column, table, index, migration, backfill, or no
   persistence change.
5. **Existing data:** exact behavior for old rows, nulls, blanks, missing fields, legacy enum
   values, and projects not yet configured for the feature.
6. **Invocation:** which endpoint or event invokes it, whether that endpoint is externally
   scheduled, and whether any compatibility-sensitive endpoint name is preserved.
7. **Regression proof:** characterization tests for current behavior plus tests for the new
   behavior, boundary failures, and relevant contract/documentation checks.
8. **Rollback:** the operational off-switch and code/data rollback path, including whether a
   migration is safely reversible or should remain in place.

Do not ask these eight questions back to the developer as a form. Investigate and answer them.
Ask only focused questions whose answers are not available in the repository and would
materially change customer behavior or the safe implementation.

## When the agent must pause and ask

Ask before implementation when product intent is genuinely unresolved, including:

- what customers should receive or see in an ambiguous state;
- whether silence, retry, fallback, or an explicit failure message is desired;
- which projects or recipients are in scope when configuration cannot express it;
- what default existing projects should receive when more than one compatible default is
  plausible;
- whether a requested contract or invariant change is intentional;
- whether a destructive or irreversible data operation is acceptable.

A question must include the repository evidence, the recommended answer, and the concrete
consequence of each materially different choice.

## Default implementation shape

Features should normally be additive:

- preserve public endpoint names, payloads, externally configured schedules, authentication
  behavior, and existing message semantics;
- add a named route-level capability through application orchestration and composition;
- put deterministic business decisions in domain policy;
- put vendor behavior behind a port and adapter;
- use validated configuration rather than project-code conditionals;
- give new optional behavior a backward-compatible default that preserves old rows;
- use forward-only additive migrations unless removal is explicitly required;
- update the service contract, configuration documentation, message-shape documentation, and
  HALO semantics when their surfaces change.

Refactor only the minimum structure needed to give the feature one clear owner and a test
seam. Do not combine a feature with an unrelated rewrite or language migration.

## Verification and handoff

Before calling a feature complete, the agent must:

- run the repository's unit, characterization, architecture, contract, and SQL checks;
- state which live integrations were exercised and which were not;
- confirm endpoint names and scheduled invocation contracts did not drift;
- confirm existing projects retain their prior behavior by default;
- summarize changed customer behavior, operational enablement, monitoring, and rollback;
- identify any skipped tests or credentials that prevent a production-equivalence claim.

Passing mocked tests is not proof that credentialed integrations or migrations work in a
deployed environment. Say so plainly and propose a canary or staging verification when
appropriate.

