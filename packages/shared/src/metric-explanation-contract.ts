import { z } from 'zod';

const SourceRow = z.object({ sheet: z.string(), row: z.number().int().positive() });
export const MetricExplanationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unavailable'), reason: z.string() }),
  z.object({
    status: z.literal('available'), evidenceKind: z.literal('reproduced_from_retained_rows'),
    snapshotId: z.string(), asOf: z.string(), period: z.string(),
    year: z.number().nullable(), department: z.string().nullable(),
    definition: z.object({ key: z.string(), label: z.string(), unit: z.string() }).passthrough(),
    value: z.number().nullable(), rows: z.array(SourceRow),
    operands: z.array(z.object({ key: z.string(), label: z.string(), value: z.number().nullable(), rows: z.array(SourceRow) })),
  }),
]);
export const MetricDetailSchema = z.object({ explanation: MetricExplanationSchema.nullable() }).passthrough();
export type MetricExplanation = z.infer<typeof MetricExplanationSchema>;
