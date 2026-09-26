export type SensorLabelValidation = { ok: true } | { ok: false; error: string };

/** Keep the value CloudLynx displays byte-for-byte apart from forbidding edge whitespace. */
export function validateWbgtSensorLabel(value: unknown): SensorLabelValidation {
  if (typeof value !== "string") return { ok: false, error: "Sensor label must be text." };
  if (!value || !value.trim()) return { ok: false, error: "Sensor label cannot be blank." };
  if (value !== value.trim()) return { ok: false, error: "Remove spaces before or after the sensor label." };
  if (value.length > 200) return { ok: false, error: "Sensor label must be 200 characters or fewer." };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: "Sensor label cannot contain control characters." };
  return { ok: true };
}
