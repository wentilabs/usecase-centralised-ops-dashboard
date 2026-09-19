import "server-only";

import { createMetrics, type Metrics } from "./metrics";

/**
 * The one recorder the server writes to.
 *
 * On globalThis for the reason the caches are: Next bundles route handlers
 * separately from server components, so a module-scoped instance would give
 * /api/metrics a different recorder from the one the pages write to, and the
 * endpoint would report an empty process that is in fact busy. That exact bug
 * is documented on the field-spec cache, having already happened once.
 *
 * Reset on nothing: the numbers describe this process since it booted, and the
 * sample window in `createMetrics` is what keeps them recent.
 */
const globalMetrics = globalThis as typeof globalThis & { __haloMetrics?: Metrics };

export const metrics: Metrics = (globalMetrics.__haloMetrics ??= createMetrics());
