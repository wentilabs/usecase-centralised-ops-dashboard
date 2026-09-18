import type { CanonicalProject } from "./canonical-projects";
import type { OnboardDefinition, OnboardDraft } from "./onboarding";

/**
 * Exact, approved equivalences only. The result is a draft suggestion; the
 * operator sees and may change every value before the disabled row is created.
 */
export function onboardingDraftFromCanonicalProject(
  definition: OnboardDefinition,
  project: CanonicalProject,
): OnboardDraft {
  const common: Record<string, string | null> = {
    project_code: project.service_aliases[definition.service] ?? project.primary_alias,
    company: project.company,
    lambda_url: project.send_message_url,
    reply_lambda_url: project.reply_message_url,
    lambda_url_image: project.send_document_url,
    instance_name: project.whatsapp_instance_name,
    client_id: project.whatsapp_client_id,
    timezone: project.timezone,
  };
  if (definition.service === "haze" || definition.service === "lightning") {
    common.site_address = project.site_address;
    common.latitude = project.latitude === null ? null : String(project.latitude);
    common.longitude = project.longitude === null ? null : String(project.longitude);
  }
  if (definition.service === "issueChaser") common.safety_sheet_id = project.safety_workbook_id;
  if (definition.service === "subcon") common.spreadsheet_id = project.manpower_workbook_id;
  if (definition.service === "wbgt") common.manpower_spreadsheet_id = project.manpower_workbook_id;

  // Onboarding rejects unknown draft keys. The service-owned definition is the
  // final allow-list, which keeps a future schema difference from being guessed.
  const allowed = new Set(definition.fields.map((field) => field.column));
  return Object.fromEntries(
    Object.entries(common).filter(([column, value]) => allowed.has(column) && value !== null && value !== ""),
  ) as OnboardDraft;
}
