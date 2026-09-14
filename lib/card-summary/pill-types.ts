export type Pill = { label: string; on: boolean; tone?: "warn" | "info" };
export type PillProvider = (config: import("../services").ProjectConfigRow) => Pill[];
