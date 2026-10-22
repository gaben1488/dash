import { z } from 'zod';

const SourceRow = z.object({ sheet: z.string(), row: z.number().int().positive() });
/**
 * The audited result context is formed by the same CalcEngine that generated
 * the saved value. It cannot be inferred from the visible card alone.
 * Fingerprints are nullable for legacy snapshots — never pretend that a
 * historical value has modern provenance merely because its number matches.
 */
export const MetricResultContextSchema = z.object({
  grain: z.literal('department_sheet_row'),
  scope: z.object({
    sourceSheets: z.array(z.string()).min(1),
    department: z.string().nullable(),
    method: z.enum(['competitive', 'ep']).nullable(),
    period: z.string(),
    year: z.number().int().nullable(),
  }),
  dependencies: z.array(z.string()),
  formula: z.string(),
  version: z.object({
    snapshotId: z.string(),
    calculationContextId: z.string().nullable(),
    semanticsHash: z.string().nullable(),
    sourceContentHash: z.string().nullable(),
    sourceProfilesHash: z.string().nullable(),
    status: z.enum(['captured', 'legacy_without_context']),
  }),
});

export const MetricExplanationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unavailable'), reason: z.string() }),
  z.object({
    status: z.literal('available'), evidenceKind: z.literal('reproduced_from_retained_rows'),
    snapshotId: z.string(), asOf: z.string(), period: z.string(),
    resultContext: MetricResultContextSchema,
    year: z.number().nullable(), department: z.string().nullable(),
    definition: z.object({ key: z.string(), label: z.string(), unit: z.string() }).passthrough(),
    value: z.number().nullable(), rows: z.array(SourceRow),
    operands: z.array(z.object({ key: z.string(), label: z.string(), unit: z.string().nullable(), value: z.number().nullable(), rows: z.array(SourceRow) })),
  }),
]);
export const MetricDetailSchema = z.object({ explanation: MetricExplanationSchema.nullable() }).passthrough();
export type MetricExplanation = z.infer<typeof MetricExplanationSchema>;
