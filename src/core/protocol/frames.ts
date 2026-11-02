import { z } from 'zod';

const hex = (length: number) => z.string().regex(new RegExp(`^[0-9a-f]{${length}}$`));

export const messageIdSchema = hex(32);

/** Keeps the triple-encrypted gift wrap well under common relay event-size limits. */
export const MAX_TEXT_LENGTH = 4096;

const hello = z.object({
  t: z.literal('hello'),
  proof: hex(64),
  name: z.string().min(1).max(40),
});

const msg = z.object({
  t: z.literal('msg'),
  id: messageIdSchema,
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  sentAt: z.number().int().nonnegative(),
  replyTo: messageIdSchema.optional(),
});

const receipt = z.object({
  t: z.literal('receipt'),
  ids: z.array(messageIdSchema).min(1).max(500),
  state: z.enum(['delivered', 'read']),
});

const presence = z.object({
  t: z.literal('presence'),
  state: z.enum(['online', 'offline']),
});

const typing = z.object({ t: z.literal('typing') });

const frameSchema = z.discriminatedUnion('t', [hello, msg, receipt, presence, typing]);

export type Frame = z.infer<typeof frameSchema>;
export type MsgFrame = z.infer<typeof msg>;
export type ReceiptFrame = z.infer<typeof receipt>;

/** Returns null for anything that isn't a well-formed frame. */
export function parseFrame(value: unknown): Frame | null {
  const result = frameSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Ephemeral frames are not stored by relays and are useless when delivered late. */
export function isEphemeral(frame: Frame): boolean {
  return frame.t === 'presence' || frame.t === 'typing';
}
