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

/** Largest attachment we transfer; also bounds how long a direct transfer can take. */
export const MAX_FILE_SIZE = 100 * 1024 * 1024;

const attachment = z.object({
  kind: z.enum(['image', 'video', 'audio', 'file']),
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(100),
  size: z.number().int().positive().max(MAX_FILE_SIZE),
  sha256: hex(64),
  /** Tiny base64 JPEG shown while the real file is still on its way. */
  thumb: z.string().max(16_000).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** Milliseconds, for audio and video. */
  duration: z.number().int().nonnegative().optional(),
});
export type Attachment = z.infer<typeof attachment>;

const coordinates = {
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Metres. */
  acc: z.number().nonnegative().max(100_000).optional(),
};

const location = z.object({
  ...coordinates,
  /** Set for live location: updates stop after this time (ms). */
  liveUntil: timestamp.optional(),
});
export type SharedLocation = z.infer<typeof location>;

const msg = z
  .object({
    t: z.literal('msg'),
    id: messageIdSchema,
    /** Caption for attachments; may be empty then. */
    text: z.string().max(MAX_TEXT_LENGTH),
    sentAt: timestamp,
    replyTo: messageIdSchema.optional(),
    /** Disappearing messages: seconds after `sentAt` when both phones remove it. */
    ttl: z
      .number()
      .int()
      .positive()
      .max(DISAPPEAR_OPTIONS[DISAPPEAR_OPTIONS.length - 1]!)
      .optional(),
    file: attachment.optional(),
    loc: location.optional(),
  })
  .refine((m) => m.text.length > 0 || !!m.file || !!m.loc, 'empty message')
  .refine((m) => !(m.file && m.loc), 'file and location in one message');

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

/** WebRTC signaling for the direct file link; ephemeral, only useful while both are online. */
const rtc = z.object({
  t: z.literal('rtc'),
  /** Connection attempt id, so stale signals from an earlier attempt are ignored. */
  sid: hex(16),
  kind: z.enum(['want', 'offer', 'answer', 'ice', 'bye']),
  sdp: z.string().max(20_000).optional(),
  candidate: z
    .object({
      candidate: z.string().max(1_000),
      sdpMid: z.string().max(100).nullable().optional(),
      sdpMLineIndex: z.number().int().nonnegative().nullable().optional(),
    })
    .optional(),
});
export type RtcFrame = z.infer<typeof rtc>;

/** Live location position update; ephemeral, the last one is what the other side keeps. */
const locLive = z.object({
  t: z.literal('locLive'),
  id: messageIdSchema,
  ...coordinates,
  at: timestamp,
});

/** Live location stopped early (durable, so the map stops showing "live" later too). */
const locEnd = z.object({ t: z.literal('locEnd'), id: messageIdSchema, at: timestamp });

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
  rtc,
  locLive,
  locEnd,
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
  return (
    frame.t === 'presence' || frame.t === 'typing' || frame.t === 'rtc' || frame.t === 'locLive'
  );
}
