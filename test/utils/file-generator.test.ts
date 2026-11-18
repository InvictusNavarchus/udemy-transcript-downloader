// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { generateZip } from '@/utils/file-generator';
import type { UdemyCurriculumItem } from '@/utils/types';
import { fixtureJson } from '../helpers';

type Item = Pick<UdemyCurriculumItem, 'type' | 'title' | 'markdownContent'>;

const chapter = (title: string): Item => ({ type: 'chapter', title });
const lecture = (title: string, markdownContent?: string): Item => ({ type: 'lecture', title, markdownContent });

/** Runs generateZip and captures the "downloaded" zip instead of triggering a real download. */
const runGenerateZip = async (items: Item[], courseTitle: string) => {
  let blob: Blob | undefined;
  let downloadName = '';
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloadName = this.download;
  });

  await generateZip(items as UdemyCurriculumItem[], courseTitle);

  const entries = unzipSync(new Uint8Array(await blob!.arrayBuffer()));
  const files = Object.fromEntries(Object.entries(entries).map(([path, data]) => [path, strFromU8(data)]));
  return { downloadName, files };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateZip', () => {
  it('builds chapter folders and per-chapter lecture numbering from the course-a curriculum', async () => {
    const raw = fixtureJson('course-a', 'curriculum.json');
    const items: Item[] = raw.results.map((r: any) =>
      r._class === 'chapter' ? chapter(r.title) : lecture(r.title, `Transcript of ${r.title}`)
    );

    const { downloadName, files } = await runGenerateZip(items, 'Touch Typing Course');

    expect(downloadName).toBe('Touch Typing Course_Transcripts.zip');
    expect(Object.keys(files).sort()).toEqual([
      '01_Introduction/01_Welcome to the course.md',
      '01_Introduction/02_Introduction to Touch Typing.md',
      '02_Practice/01_Typing Marathon - keeping going.md',
      '03_Summary and next steps/01_Lets look back.md',
      'Touch Typing Course_Full.md',
    ]);
    expect(files['01_Introduction/01_Welcome to the course.md']).toBe('Transcript of Welcome to the course!');
  });

  it('writes a merged file with original (unsanitized) titles', async () => {
    const { files } = await runGenerateZip(
      [chapter("What's next?"), lecture('Thank you and good luck!', 'Bye.'), lecture('Second', 'Two.')],
      'My Course: Part 1'
    );

    expect(files['My Course Part 1_Full.md']).toBe(
      '# My Course: Part 1\n\n' +
        "\n\n## 1. What's next?\n\n" +
        '### 1. Thank you and good luck!\n\nBye.\n\n---\n\n' +
        '### 2. Second\n\nTwo.\n\n---\n\n'
    );
  });

  it('puts lectures before the first chapter into 00_Intro', async () => {
    const { files } = await runGenerateZip([lecture('Orphan', 'x'), chapter('First'), lecture('Inside', 'y')], 'C');
    expect(Object.keys(files).sort()).toEqual(['00_Intro/01_Orphan.md', '01_First/01_Inside.md', 'C_Full.md']);
  });

  it('skips lectures without content and non-lecture items without consuming a number', async () => {
    const { files } = await runGenerateZip(
      [
        chapter('Ch'),
        lecture('No content'),
        { type: 'quiz', title: 'Quiz' },
        { type: 'other', title: 'Other' },
        lecture('Has content', 'z'),
      ],
      'C'
    );
    expect(Object.keys(files).sort()).toEqual(['01_Ch/01_Has content.md', 'C_Full.md']);
  });

  it('still writes a file for the "No Transcript Available" placeholder', async () => {
    const { files } = await runGenerateZip([chapter('Ch'), lecture('Silent', '> [No Transcript Available]')], 'C');
    expect(files['01_Ch/01_Silent.md']).toBe('> [No Transcript Available]');
  });

  it('numbers chapters even when a chapter has no lectures', async () => {
    const { files } = await runGenerateZip([chapter('Empty'), chapter('Second'), lecture('L', 'x')], 'C');
    expect(Object.keys(files).sort()).toEqual(['02_Second/01_L.md', 'C_Full.md']);
  });

  it('revokes the download URL only after a delay, not right after the click', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
      const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      await generateZip([lecture('One', 'text')] as UdemyCurriculumItem[], 'Course');
      expect(revoke).not.toHaveBeenCalled();

      vi.runAllTimers();
      expect(revoke).toHaveBeenCalledWith('blob:test');
    } finally {
      vi.useRealTimers();
    }
  });
});
