import { addDays, format, nextSaturday, startOfDay } from 'date-fns';
import type { Label, Priority, Project, Recurrence } from '../api/types';
import { parseQuickAdd } from './quickAdd';

/**
 * Turns the free text of a sticky note into suggested tasks, entirely on this device (no AI service):
 *  - numbered or bulleted lines (1. / 1) / - / * / • / [ ]) become one task each; indented lines under an item
 *    become that task's description; an item already ticked ([x]) is skipped;
 *  - a short heading line ending in ":" ("Tomorrow:", "Rehab:") sets the date or project for the items below it;
 *  - plain text is split into sentences, and a sentence listing several actions ("call Bob and email Ann") is
 *    split again at the action words;
 *  - filler such as "remember to", "need to", "don't forget to" is dropped from titles;
 *  - dates, times, repeats, p1-p4, #project and @label are read by the quick-add parser, plus casual phrases
 *    ("tonight", "this afternoon", "later") and project names mentioned in plain words.
 * Sentences that do not read like something to do are suggested but left unticked; the user approves the list.
 */

export interface TaskSuggestion {
  key: string;
  title: string;
  description: string;
  dueDate?: string;
  dueTime?: string;
  priority?: Priority;
  projectId?: string;
  labelIds: string[];
  newLabelNames: string[];
  recurrence?: Recurrence;
  /** Pre-ticked in the review list: it reads like an action, or it came from a list item. */
  selected: boolean;
  /** The text it was made from, shown on hover in the review list. */
  source: string;
}

interface Context {
  projects: Project[];
  labels: Label[];
  now?: Date;
}

const MAX_SUGGESTIONS = 30;

const LIST_ITEM = /^(\s*)(?:[-*+•▪◦‣]|\d{1,3}[.)]|[a-zA-Z][.)](?=\s))\s+(?:\[( |x|X)\]\s+)?(.*)$/;
const BARE_CHECKBOX = /^(\s*)\[( |x|X)\]\s+(.*)$/;

const FILLER =
  /^(?:(?:please|pls|plz|ok|okay|so|also|and|then|oh|btw|reminder|todo|to-?do|task|note)[:,]?\s+)*(?:(?:i|we)\s+(?:need|have|got|must|should|will|gotta|want)\s+(?:to\s+)?|(?:i'll|we'll|i'm going to|i am going to|let's|lets|gotta|gonna|must|should|need to|have to|has to|got to|remember to|don'?t forget to|do not forget to|make sure to|be sure to|try to|go and|go)\s+)/i;

const ACTION_VERBS = new Set(
  (
    'add ask arrange attend approve book bring buy call cancel change check clean clear close collect commit complete confirm contact ' +
    'create debug decide deliver deploy design discuss do download draft drop edit email e-mail enable estimate export file fill ' +
    'finalise finalize find finish fix follow get give go handle hire implement improve install invite investigate invoice ' +
    'join look mail make meet merge message migrate move order organise organize pack pay pick ping plan post prepare present ' +
    'print publish pull push put qa read reboot record refactor refund register release remind remove renew reply report request ' +
    'research reschedule reserve resolve respond restart return review revise run schedule send set setup share ship sign sort ' +
    'start submit sync take talk test text think tidy top train transfer translate try update upgrade upload validate verify ' +
    'visit wash watch write'
  ).split(' '),
);

const ACTION_NOUNS = /\b(meeting|appointment|interview|deadline|due|demo|standup|stand-up|follow[- ]?up)\b|会议|开会|截止/i;

/** Reads like something that already happened or a remark, not a to-do. */
const PAST_OR_REMARK = /\b(yesterday|last (?:week|night|month)|already|went|was|were|did|had|done|finished|happened)\b|昨天|已经/i;

/** "...I have to <action>" in the middle of a sentence: the action starts after the cue. */
const MID_CUE = /\b(?:i|we)\s+(?:need|have|got|must|should|will|gotta|want)\s+(?:to\s+)?|\b(?:remember|don'?t forget|make sure) to\s+/i;

/** Chinese fillers ("remember to", "need to", "don't forget") at the start of a title. */
const ZH_FILLER = /^(?:记得|别忘了|不要忘了|要|需要|得|必须)\s*/u;

/** Casual time phrases the quick-add parser does not know. Applied when the text has no explicit time. */
const CASUAL_TIMES: { pattern: RegExp; days: number; time?: string }[] = [
  { pattern: /\b(?:tonight|this evening)\b/i, days: 0, time: '20:00' },
  { pattern: /\bthis afternoon\b/i, days: 0, time: '14:00' },
  { pattern: /\bthis morning\b/i, days: 0, time: '09:00' },
  { pattern: /\btomorrow (?:morning)\b/i, days: 1, time: '09:00' },
  { pattern: /\btomorrow (?:afternoon)\b/i, days: 1, time: '14:00' },
  { pattern: /\btomorrow (?:night|evening)\b/i, days: 1, time: '20:00' },
  { pattern: /\b(?:by )?(?:end of (?:the )?day|eod)\b/i, days: 0, time: '17:00' },
  { pattern: /\bafter lunch\b/i, days: 0, time: '14:00' },
  { pattern: /\bbefore lunch\b/i, days: 0, time: '11:00' },
  { pattern: /\blater(?: today| on)?\b/i, days: 0 },
  // Chinese: tonight, tomorrow night, tomorrow morning, today, the day after tomorrow, tomorrow.
  { pattern: /今晚/u, days: 0, time: '20:00' },
  { pattern: /明晚/u, days: 1, time: '20:00' },
  { pattern: /明早|明天早上/u, days: 1, time: '09:00' },
  { pattern: /今天/u, days: 0 },
  { pattern: /后天/u, days: 2 },
  { pattern: /明天/u, days: 1 },
];

// Short words that are also weekday abbreviations or "today": only treated as dates after "on", "by", etc.
const AMBIGUOUS_DATE_WORDS = /(^|\s)(sun|sat|wed|mon|tue|tues|thu|thur|thurs|fri|tod)(?=\s|$)/gi;
const DATE_LEAD = /(?:on|by|before|this|next|every|until|till|due)\s*$/i;
const GUARD = '⁠'; // word joiner: hides a token from the parser, removed afterwards

function protectAmbiguous(text: string): string {
  return text.replace(AMBIGUOUS_DATE_WORDS, (match, lead: string, word: string, offset: number) => {
    const before = text.slice(0, offset + lead.length);
    return DATE_LEAD.test(before) ? match : `${lead}${GUARD}${word}`;
  });
}

const stripGuard = (text: string) => text.split(GUARD).join('');

function cleanTitle(text: string): string {
  let title = text.trim().replace(/\s+([,;!?])/g, '$1').replace(/[\s,;:.!?。！？；]+$/u, '');
  // A dangling remark after the action: "renew the domain, it's" (its "urgent" was read as priority).
  title = title.replace(/[,;]\s*(?:it'?s|it is|this is|which is|that'?s|pls|please)?\s*$/i, '');
  title = title.replace(ZH_FILLER, '');
  for (let i = 0; i < 3; i++) {
    const next = title.replace(FILLER, '');
    if (next === title) break;
    title = next;
  }
  title = title
    .replace(/\s+(?:on|by|at|before|for|due|until|till|around|about)\s*$/i, '')
    .replace(/[\s,;:.!?。！？；]+$/u, '')
    .replace(/^[\s,;:.\-–—]+/u, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function firstWord(text: string): string {
  const cleaned = text.replace(FILLER, '').trim().toLowerCase();
  return cleaned.split(/[\s,.:;!?]+/)[0] ?? '';
}

function looksActionable(raw: string, parsedSomething: boolean): boolean {
  if (FILLER.test(raw.trim()) || MID_CUE.test(raw) || ZH_FILLER.test(raw.trim())) return true;
  if (ACTION_VERBS.has(firstWord(raw))) return true;
  if (PAST_OR_REMARK.test(raw)) return false;
  if (parsedSomething) return true;
  return ACTION_NOUNS.test(raw);
}

/** The longest non-Inbox project whose name appears in the text as whole words. */
function mentionedProject(text: string, projects: Project[]): string | undefined {
  const lower = ` ${text.toLowerCase()} `;
  let best: Project | undefined;
  for (const project of projects) {
    if (project.isInbox || project.name.trim().length < 3) continue;
    const name = project.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`[^\\p{L}\\p{N}]${name}[^\\p{L}\\p{N}]`, 'u').test(lower) && (!best || project.name.length > best.name.length)) {
      best = project;
    }
  }
  return best?.id;
}

interface Parsed {
  title: string;
  dueDate?: string;
  dueTime?: string;
  priority?: Priority;
  projectId?: string;
  labelIds: string[];
  newLabelNames: string[];
  recurrence?: Recurrence;
  parsedSomething: boolean;
}

function parseLine(raw: string, ctx: Context): Parsed {
  const now = ctx.now ?? new Date();
  const today = startOfDay(now);
  let text = raw;
  let casualDate: string | undefined;
  let casualTime: string | undefined;
  for (const casual of CASUAL_TIMES) {
    if (casual.pattern.test(text)) {
      casualDate ??= format(addDays(today, casual.days), 'yyyy-MM-dd');
      casualTime ??= casual.time;
      text = text.replace(casual.pattern, ' ');
    }
  }
  if (/\bthis weekend\b/i.test(text)) {
    casualDate ??= format(today.getDay() === 6 ? today : nextSaturday(today), 'yyyy-MM-dd');
    text = text.replace(/\bthis weekend\b/i, ' ');
  }

  let priority: Priority | undefined;
  if (/\b(?:urgent|asap|a\.s\.a\.p\.?)\b|!!+/i.test(text)) priority = 1;
  else if (/\b(?:important|high priority)\b/i.test(text)) priority = 2;
  text = text.replace(/\(?\b(?:urgent|asap|a\.s\.a\.p\.?|high priority)\b\)?|!!+/gi, ' ');

  // "After lunch I have to review X": keep the action as the title; the lead-in only carries timing.
  const cue = MID_CUE.exec(text);
  if (cue && cue.index > 0) text = text.slice(cue.index + cue[0].length);

  // Give the parser whitespace around punctuation, so "next week," is still read as a date.
  text = text.replace(/([,;!?])(?=\s|$)/g, ' $1');
  const quick = parseQuickAdd(protectAmbiguous(text), { projects: ctx.projects, labels: ctx.labels, now });
  const dueDate = quick.dueDate ?? casualDate;
  const dueTime = quick.dueTime ?? casualTime;
  const title = cleanTitle(stripGuard(quick.content));
  return {
    title,
    dueDate,
    dueTime: dueDate ? dueTime : undefined,
    priority: quick.priority ?? priority,
    projectId: quick.projectId ?? mentionedProject(raw, ctx.projects),
    labelIds: quick.labelIds,
    newLabelNames: quick.newLabelNames,
    recurrence: quick.recurrence,
    parsedSomething: Boolean(dueDate || quick.priority || priority || quick.projectId || quick.labelIds.length || quick.newLabelNames.length),
  };
}

/** Split plain prose into sentences, then split a sentence that lists several actions. */
function splitProse(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。！？；;])\s+|(?<=[。！？；])/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const parts: string[] = [];
  for (const sentence of sentences) {
    // "call Bob, email Ann and book the room" -> three actions; only split where an action verb follows.
    const pieces = sentence.split(/\s*(?:,\s*(?:and\s+|then\s+|also\s+)?|\s+(?:and then|then|and also|and|also|plus)\s+)(?=\S)/i);
    let current = pieces[0] ?? '';
    for (const piece of pieces.slice(1)) {
      if (ACTION_VERBS.has(firstWord(piece))) {
        parts.push(current);
        current = piece;
      } else {
        current = `${current}${/^(?:and|then|also)\b/i.test(piece) ? ' ' : ', '}${piece}`;
      }
    }
    parts.push(current);
  }
  return parts.map((p) => p.trim()).filter((p) => p.replace(/[\s.,;:!?]/g, '').length > 1);
}

interface Item {
  text: string;
  done: boolean;
  details: string[];
  fromList: boolean;
  /** Date or project from a heading line above ("Tomorrow:", "Rehab:"). */
  headingDate?: string;
  headingProjectId?: string;
}

function collectItems(text: string, ctx: Context): Item[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const listLines = lines.filter((l) => LIST_ITEM.test(l) || BARE_CHECKBOX.test(l)).length;
  const items: Item[] = [];
  let headingDate: string | undefined;
  let headingProjectId: string | undefined;

  if (listLines === 0) {
    for (const part of splitProse(text)) items.push({ text: part, done: false, details: [], fromList: false });
    return items;
  }

  let baseIndent: number | null = null;
  let prose: string[] = [];
  const flushProse = () => {
    if (prose.length === 0) return;
    for (const part of splitProse(prose.join(' '))) items.push({ text: part, done: false, details: [], fromList: false, headingDate, headingProjectId });
    prose = [];
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    const match = LIST_ITEM.exec(line) ?? BARE_CHECKBOX.exec(line);
    if (match) {
      const indent = match[1].replace(/\t/g, '    ').length;
      const box = match.length === 4 && LIST_ITEM.test(line) ? match[2] : match[2];
      const body = (LIST_ITEM.test(line) ? match[3] : match[3]) ?? '';
      baseIndent ??= indent;
      if (indent > baseIndent && items.length > 0 && items[items.length - 1].fromList) {
        // A nested item belongs to the task above it.
        items[items.length - 1].details.push(`- ${body.trim()}`);
        continue;
      }
      flushProse();
      items.push({ text: body, done: box === 'x' || box === 'X', details: [], fromList: true, headingDate, headingProjectId });
      continue;
    }
    const trimmed = line.trim();
    const isHeading = /[:：]$/.test(trimmed) && trimmed.split(/\s+/).length <= 6;
    if (isHeading) {
      flushProse();
      const parsed = parseLine(trimmed.replace(/[:：]$/, ''), ctx);
      headingDate = parsed.dueDate;
      headingProjectId =
        ctx.projects.find((p) => !p.isInbox && p.name.toLowerCase() === trimmed.replace(/[:：]$/, '').trim().toLowerCase())?.id ??
        parsed.projectId;
      continue;
    }
    if (/^\s{2,}|\t/.test(line) && items.length > 0 && items[items.length - 1].fromList) {
      // An indented plain line continues the item above as its description.
      items[items.length - 1].details.push(trimmed);
      continue;
    }
    prose.push(trimmed);
  }
  flushProse();
  return items;
}

export function noteToTasks(text: string, ctx: Context): TaskSuggestion[] {
  const items = collectItems(text, ctx).filter((item) => !item.done);
  const suggestions: TaskSuggestion[] = [];
  for (const [index, item] of items.entries()) {
    const parsed = parseLine(item.text, ctx);
    if (!parsed.title) continue;
    const actionable = item.fromList || looksActionable(item.text, parsed.parsedSomething);
    suggestions.push({
      key: `s${index}`,
      title: parsed.title,
      description: item.details.join('\n'),
      dueDate: parsed.dueDate ?? item.headingDate,
      dueTime: parsed.dueDate ? parsed.dueTime : undefined,
      priority: parsed.priority,
      projectId: parsed.projectId ?? item.headingProjectId,
      labelIds: parsed.labelIds,
      newLabelNames: parsed.newLabelNames,
      recurrence: parsed.recurrence,
      selected: actionable,
      source: item.text.trim(),
    });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  // When nothing reads like an action (e.g. a language the verb list does not cover), offer everything ticked.
  if (suggestions.length > 0 && suggestions.every((s) => !s.selected)) suggestions.forEach((s) => (s.selected = true));
  return suggestions;
}
