import { describe, expect, it } from 'vitest';
import { sanitizeFileName, vttToMarkdown } from '@/utils/helpers';
import { fixtureText } from '../helpers';

describe('vttToMarkdown', () => {
  it('flattens course-a captions (numbered cues, HH:MM:SS timestamps)', () => {
    expect(vttToMarkdown(fixtureText('course-a', 'captions.vtt'))).toBe(
      'Have you ever thought about how much time you spend typing? ' +
        'Work tasks, messages, chats, school and university projects. ' +
        'We type all of these by hand.'
    );
  });

  it('flattens course-b captions (no cue IDs, MM:SS timestamps, sentence split across cues)', () => {
    expect(vttToMarkdown(fixtureText('course-b', 'captions.vtt'))).toBe(
      'Hello and welcome to how to create an online course. ' +
        "The official Udemy course, we're thrilled that you're interested in teaching with us. " +
        "We believe in creating new opportunities for everyone by opening up knowledge, and that's where you come in."
    );
  });

  it('handles CRLF line endings', () => {
    const vtt = fixtureText('course-a', 'captions.vtt').replace(/\n/g, '\r\n');
    expect(vttToMarkdown(vtt)).toBe(vttToMarkdown(fixtureText('course-a', 'captions.vtt')));
  });

  it('returns an empty string for empty input', () => {
    expect(vttToMarkdown('')).toBe('');
  });

  it('keeps a caption line that is only a number', () => {
    expect(vttToMarkdown('WEBVTT\n\n00:01.000 --> 00:02.000\nThe year was\n\n00:02.000 --> 00:03.000\n2024\n')).toBe(
      'The year was 2024'
    );
  });

  it('keeps a caption line that starts with a clock time', () => {
    expect(vttToMarkdown('WEBVTT\n\n00:01.000 --> 00:02.000\n10:30 is when we start.\n')).toBe('10:30 is when we start.');
  });

  it('strips WebVTT voice tags', () => {
    expect(vttToMarkdown('WEBVTT\n\n00:01.000 --> 00:02.000\n<v Speaker>Hello there</v>\n')).toBe('Hello there');
  });

  it('strips formatting, class and inline timestamp tags', () => {
    expect(
      vttToMarkdown('WEBVTT\n\n00:01.000 --> 00:03.000\n<i>Very</i> <c.yellow>bright</c> <00:00:02.000>idea\n')
    ).toBe('Very bright idea');
  });

  it('decodes character references after stripping tags', () => {
    expect(
      vttToMarkdown('WEBVTT\n\n00:01.000 --> 00:02.000\nR&amp;D uses &lt;b&gt; tags &#8212; &#x2014; caf&eacute;\n')
    ).toBe('R&D uses <b> tags \u2014 \u2014 caf&eacute;');
  });

  it('skips header metadata, NOTE and STYLE blocks', () => {
    const vtt = [
      'WEBVTT - Lecture 1',
      'Kind: captions',
      'Language: en',
      '',
      'NOTE This is a comment',
      'spanning two lines',
      '',
      'STYLE',
      '::cue { color: lime }',
      '',
      '00:01.000 --> 00:02.000 align:start position:10%',
      'Only this.',
      '',
    ].join('\n');
    expect(vttToMarkdown(vtt)).toBe('Only this.');
  });

  it('joins a cue with several text lines', () => {
    expect(vttToMarkdown('WEBVTT\n\nintro\n00:01.000 --> 00:02.000\nFirst line\nsecond line\n')).toBe(
      'First line second line'
    );
  });
});

describe('sanitizeFileName', () => {
  // Accepted behavior: punctuation that is unsafe or awkward in file names is removed.
  it.each([
    ["Plan what you're going to say", 'Plan what youre going to say'],
    ["What's next?", 'Whats next'],
    ['Activity: Create a test video', 'Activity Create a test video'],
    ['Welcome to the course!', 'Welcome to the course'],
    ['Let’s look back', 'Lets look back'],
    ['keeps-hyphens_and_underscores', 'keeps-hyphens_and_underscores'],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('falls back to "untitled" when nothing is left', () => {
    expect(sanitizeFileName('?!:')).toBe('untitled');
    expect(sanitizeFileName('   ')).toBe('untitled');
  });

  it('truncates to 100 characters', () => {
    expect(sanitizeFileName('a'.repeat(150))).toHaveLength(100);
  });

  // Known bug: dash-like characters are deleted instead of becoming a hyphen,
  // e.g. "Typing Marathon — keeping going" -> "Typing Marathon  keeping going".
  it.fails.each([
    ['em dash', 'Typing Marathon — keeping going', 'Typing Marathon - keeping going'],
    ['en dash', 'Pages 1–10', 'Pages 1-10'],
    ['minus sign', 'Score −5', 'Score -5'],
  ])('converts %s to a hyphen', (_, input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  // Known bug: every non-ASCII letter is stripped, so non-English titles lose their names.
  it.fails('keeps accented letters', () => {
    expect(sanitizeFileName('Café Français')).toBe('Café Français');
  });

  it.fails('keeps non-Latin titles', () => {
    expect(sanitizeFileName('日本語コース')).toBe('日本語コース');
  });
});
