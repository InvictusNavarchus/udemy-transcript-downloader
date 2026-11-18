import { strToU8 } from 'fflate';

export const randomDelay = async () => {
  // Random delay between 500ms and 1000ms
  const delay = Math.floor(Math.random() * 500) + 500;
  await new Promise((resolve) => setTimeout(resolve, delay));
};

export const sanitizeFileName = (name: string): string => {
  const sanitized = name.replace(/[^a-z0-9\s-_]/gi, '').trim().substring(0, 100);
  return sanitized || 'untitled';
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