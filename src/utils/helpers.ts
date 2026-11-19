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

/**
 * Decodes numeric character references and the named ones above.
 * Known limitation: WebVTT allows every HTML named reference (2,000+), but other names such as
 * "&eacute;" are left encoded. Udemy's captions are UTF-8 and have not been seen using them;
 * supporting them would mean bundling HTML's full name table.
 */
const decodeVttEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] !== '#') {
      const name = ref.toLowerCase();
      // Own keys only: a plain object also "has" constructor, toString, etc.
      return Object.hasOwn(VTT_ENTITIES, name) ? VTT_ENTITIES[name]! : match;
    }
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });

/**
 * Flattens a WebVTT file into one paragraph of Markdown-safe text.
 *
 * Works cue by cue rather than line by line: a cue is a blank-line-separated block whose
 * timing line contains `-->`. Everything before the timing line (the optional cue ID) is
 * dropped and everything after it is caption text, however much it looks like a number or a
 * timestamp. Blocks without a timing line (the WEBVTT header, NOTE, STYLE, REGION) are skipped.
 */
export const vttToMarkdown = (vttRaw: string): string => {
  if (!vttRaw) return '';

  // Per the WebVTT parser, only an empty line ends a cue; a line of spaces is part of its text.
  const blocks = vttRaw.replace(/\r\n?/g, '\n').split(/\n{2,}/);
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

  // The result is written into .md files. A decoded "<" (from "&lt;" in the captions, e.g. a
  // course that talks about <div>) would otherwise be rendered as an HTML tag and vanish from
  // Markdown previews; "\<" renders as "<" and still reads naturally as plain text.
  return texts.join(' ').replace(/\s+/g, ' ').trim().replace(/</g, '\\<');
};

export const stringToBuffer = (str: string) => strToU8(str);

/** Formats a byte count for display, e.g. 512 B, 34 KB, 1.2 MB. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  // Compare after rounding: just under 1 MB would otherwise show as "1024 KB".
  const kilobytes = Math.round(bytes / 1024);
  if (kilobytes < 1024) return `${kilobytes} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
