import { strToU8 } from 'fflate';

export const randomDelay = async () => {
  // Random delay between 500ms and 1000ms
  const delay = Math.floor(Math.random() * 500) + 500;
  await new Promise((resolve) => setTimeout(resolve, delay));
};

const MAX_NAME_CHARS = 100;
// File systems limit one name to 255 bytes (ext4, APFS) and ZIP tools follow suit. Leave room
// for what generateZip adds around a title: "01_" + ".md", or "_Transcripts.zip" (16 bytes).
const MAX_NAME_BYTES = 200;
const utf8 = new TextEncoder();

/**
 * Makes a title safe to use as a file or folder name: keeps letters and digits of any script,
 * whitespace, hyphens and underscores, and drops all other punctuation and symbols.
 * Truncated to 100 characters and 200 UTF-8 bytes, whichever is reached first, cutting only
 * between code points.
 */
export const sanitizeFileName = (name: string): string => {
  const cleaned = name
    .replace(/[\p{Pd}\u2212]/gu, '-') // em/en dashes, minus sign, etc. read as a hyphen; keep one
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, ' ') // close gaps left by removed characters; no tabs/newlines in names
    .trim();

  let truncated = '';
  let chars = 0;
  let bytes = 0;
  for (const char of cleaned) {
    const size = utf8.encode(char).length;
    if (chars === MAX_NAME_CHARS || bytes + size > MAX_NAME_BYTES) break;
    truncated += char;
    chars++;
    bytes += size;
  }

  // Trim again: truncating can leave a trailing space, which Windows rejects in names.
  return truncated.trim() || 'untitled';
};

const VTT_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };

/** Decodes the character references WebVTT cue text can contain (named ones it defines, plus numeric). */
const decodeVttEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] !== '#') return VTT_ENTITIES[ref.toLowerCase()] ?? match;
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });

/**
 * Flattens a WebVTT file into one paragraph of plain text.
 *
 * Works cue by cue rather than line by line: a cue is a blank-line-separated block whose
 * timing line contains `-->`. Everything before the timing line (the optional cue ID) is
 * dropped and everything after it is caption text, however much it looks like a number or a
 * timestamp. Blocks without a timing line (the WEBVTT header, NOTE, STYLE, REGION) are skipped.
 */
export const vttToMarkdown = (vttRaw: string): string => {
  if (!vttRaw) return '';

  const blocks = vttRaw.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  const texts: string[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const timing = lines.findIndex((line) => line.includes('-->'));
    if (timing === -1) continue;

    const payload = lines.slice(timing + 1).join(' ');
    // Strip markup (<v Speaker>, <i>, <c.yellow>, <00:00:01.000>) before decoding, so an
    // escaped "&lt;b&gt;" stays as literal text instead of being removed as a tag.
    texts.push(decodeVttEntities(payload.replace(/<[^>]*>/g, '')));
  }

  return texts.join(' ').replace(/\s+/g, ' ').trim();
};

export const stringToBuffer = (str: string) => strToU8(str);