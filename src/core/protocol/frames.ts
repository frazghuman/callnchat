import { z } from 'zod';

const hex = (length: number) => z.string().regex(new RegExp(`^[0-9a-f]{${length}}$`));

export const messageIdSchema = hex(32);
const timestamp = z.number().int().nonnegative();

/** Allowed disappearing-message timers in seconds: off, 24 hours, 7 days, 90 days. */
export const DISAPPEAR_OPTIONS = [0, 86_400, 604_800, 7_776_000] as const;
export type DisappearSeconds = (typeof DISAPPEAR_OPTIONS)[number];

/** WhatsApp-style limits, enforced by the sender. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const DELETE_FOR_EVERYONE_WINDOW_MS = 48 * 60 * 60 * 1000;

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
  sentAt: timestamp,
  replyTo: messageIdSchema.optional(),
  /** Disappearing messages: seconds after `sentAt` when both phones remove it. */
  ttl: z
    .number()
    .int()
    .positive()
    .max(DISAPPEAR_OPTIONS[DISAPPEAR_OPTIONS.length - 1]!)
    .optional(),
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

/** One reaction per person per message; null removes it. Last `at` wins. */
const react = z.object({
  t: z.literal('react'),
  id: messageIdSchema,
  emoji: z.string().min(1).max(16).nullable(),
  at: timestamp,
});

/** Carries `sentAt` so the receiver can create the message if the edit arrives first. */
const edit = z.object({
  t: z.literal('edit'),
  id: messageIdSchema,
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  sentAt: timestamp,
  editedAt: timestamp,
});

/** Delete for everyone; `sentAt` lets the receiver place a tombstone if the message hasn't arrived. */
const del = z.object({
  t: z.literal('delete'),
  items: z
    .array(z.object({ id: messageIdSchema, sentAt: timestamp }))
    .min(1)
    .max(100),
});

const timer = z.object({
  t: z.literal('timer'),
  seconds: z.union(DISAPPEAR_OPTIONS.map((s) => z.literal(s))),
  at: timestamp,
});

const frameSchema = z.discriminatedUnion('t', [
  hello,
  msg,
  receipt,
  presence,
  typing,
  react,
  edit,
  del,
  timer,
]);

export type Frame = z.infer<typeof frameSchema>;
export type MsgFrame = z.infer<typeof msg>;
export type ReceiptFrame = z.infer<typeof receipt>;
export type DeleteFrame = z.infer<typeof del>;

/** Returns null for anything that isn't a well-formed frame. */
export function parseFrame(value: unknown): Frame | null {
  const result = frameSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Ephemeral frames are not stored by relays and are useless when delivered late. */
export function isEphemeral(frame: Frame): boolean {
  return frame.t === 'presence' || frame.t === 'typing';
}
