# Data Health Message Template Design

## Purpose

Allow each WBGT or Noise project to customize the wording of its Data Health
WhatsApp reminders while continuing to use that project's existing sender
proxy. HALO stores configuration only; the Data Health worker renders and
sends the resulting message.

## Configuration

Add nullable `data_health_message_template` text columns to
`wbgts.wbgt_project_configs` and `"noise-meters".noise_project_configs`.

HALO exposes the column in the same Delivery section as `data_health_group_ids`.
Blank means the worker uses its built-in safe default. The field has no enable
switch and does not affect ordinary customer-alert templates or destinations.

## Template contract

The entire outgoing Data Health message is a template. Only these placeholders
are permitted:

- `{{project_code}}`
- `{{service}}`
- `{{status}}`
- `{{latest_receipt}}`

The worker replaces every permitted placeholder with the current event value.
Unknown or malformed placeholders reject the HALO save and are treated as an
unsafe configuration by the worker, which cancels the delivery rather than
falling back to another message or sender.

`{{status}}` is `Delayed`, `No recent data`, or `Recovered`; this gives amber,
red, and recovery notifications one predictable template without separate
per-state fields. `{{latest_receipt}}` is formatted in Asia/Singapore time; it
is `No receipt yet` when no receipt exists.

The default message remains:

```text
⚠️ Data Health — {{project_code}} ({{service}})
Status: {{status}}
Latest receipt: {{latest_receipt}}
```

The worker may use its existing recovery icon for the default only. A custom
template is rendered exactly as saved after placeholder substitution.

## Delivery and safety

Templates do not carry chat ids, sender URLs, client ids, secrets, or raw
provider responses. The worker still re-reads the project sender and dedicated
`data_health_group_ids` immediately before each attempt. It sends one rendered
message per dedicated recipient and never falls back to normal customer alert
groups.

Template configuration becomes available only after the source-schema
migrations are applied. It does not remove the remaining deployment prerequisite:
the worker needs a concrete, server-only Supabase/Lambda composition before any
live delivery can be enabled.

## Validation and tests

Tests must prove that:

1. WBGT and Noise migrations add nullable template columns.
2. HALO labels the field, explains the supported placeholders, and retains it
   without an enable gate.
3. Valid custom templates render all four values.
4. Blank templates render the safe default.
5. Unknown or malformed placeholders cannot be saved or sent.
6. Custom wording cannot change destination, sender, cadence, retry, incident,
   or TEST-only canary policy.
