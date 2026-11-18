// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCurriculum, fetchTranscript, getCourseId } from '@/utils/udemy-api';
import { vttToMarkdown } from '@/utils/helpers';
import { fixtureJson, fixtureText, type FixtureSet } from '../helpers';

// Skip the 0.5–1 s politeness delay before every request.
vi.mock('@/utils/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/helpers')>()),
  randomDelay: vi.fn(async () => {}),
}));

const COURSE_ID = 4242;
const curriculumUrl = (courseId: number) =>
  `https://www.udemy.com/api-2.0/courses/${courseId}/subscriber-curriculum-items/?curriculum_types=chapter%2Clecture%2Cquiz&page_size=1000&fields%5Blecture%5D=title%2Casset&fields%5Bchapter%5D=title`;
const lectureUrl = (courseId: number, lectureId: number) =>
  `https://www.udemy.com/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${lectureId}/?fields%5Blecture%5D=asset&fields%5Basset%5D=captions`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const text = (body: string, status = 200) => new Response(body, { status });

/** Stubs `fetch` with a URL -> Response router. Unrouted URLs return 404. */
const stubFetch = (routes: Record<string, () => Response | Promise<Response>>) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    return route ? route() : text('not found', 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('getCourseId', () => {
  const mount = (args: string) => {
    const el = document.createElement('div');
    el.setAttribute('data-module-id', 'course-taking');
    el.setAttribute('data-module-args', args);
    document.body.appendChild(el);
  };

  it('reads courseId from the course-taking module args', () => {
    mount(JSON.stringify({ courseId: 4407214, otherArg: true }));
    expect(getCourseId()).toBe(4407214);
  });

  it.each([
    ['the element is missing', null],
    ['courseId is missing', '{}'],
    ['courseId is a string', '{"courseId":"4407214"}'],
    ['args are not JSON', 'not json'],
  ])('throws a user-facing error when %s', (_, args) => {
    if (args !== null) mount(args);
    expect(() => getCourseId()).toThrow('Could not find Course ID. Ensure you are on the Course Learning Page.');
  });
});

describe('fetchCurriculum', () => {
  it.each<FixtureSet>(['course-a', 'course-b'])('maps the %s curriculum', async (set) => {
    const raw = fixtureJson(set, 'curriculum.json');
    const fetchMock = stubFetch({ [curriculumUrl(COURSE_ID)]: () => json(raw) });

    const items = await fetchCurriculum(COURSE_ID);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(curriculumUrl(COURSE_ID));
    expect(items).toHaveLength(raw.results.length);
    expect(items.map((i) => i.type)).toEqual(raw.results.map((r: any) => r._class));
    expect(items.map((i) => i.title)).toEqual(raw.results.map((r: any) => r.title));
    expect(items.every((i) => i.isCompleted === false)).toBe(true);
    expect(items.filter((i) => i.type === 'lecture').every((i) => i.asset?.asset_type === 'Video')).toBe(true);
  });

  it('maps unknown _class values to "other"', async () => {
    stubFetch({ [curriculumUrl(COURSE_ID)]: () => json({ results: [{ _class: 'practice', id: 1, title: 'x' }] }) });
    expect((await fetchCurriculum(COURSE_ID))[0].type).toBe('other');
  });

  it('throws on a non-OK response', async () => {
    stubFetch({ [curriculumUrl(COURSE_ID)]: () => text('forbidden', 403) });
    await expect(fetchCurriculum(COURSE_ID)).rejects.toThrow('Curriculum API Error: 403');
  });

  // Known bug: `next` is never followed, so courses with more than 1000 items are silently cut off.
  it.fails('follows pagination via `next`', async () => {
    const page2Url = 'https://www.udemy.com/api-2.0/courses/4242/subscriber-curriculum-items/?page=2';
    stubFetch({
      [curriculumUrl(COURSE_ID)]: () =>
        json({ count: 2, next: page2Url, results: [{ _class: 'chapter', id: 1, title: 'Page 1' }] }),
      [page2Url]: () => json({ count: 2, next: null, results: [{ _class: 'chapter', id: 2, title: 'Page 2' }] }),
    });
    expect(await fetchCurriculum(COURSE_ID)).toHaveLength(2);
  });
});

describe('fetchTranscript', () => {
  type Routes = Record<string, () => Response | Promise<Response>>;
  /** Routes the fixture's lecture and en_US VTT URLs; `overrides` can replace either. */
  const setup = (set: FixtureSet, overrides: (urls: { lecture: string; vtt: string }) => Routes = () => ({})) => {
    const lecture = fixtureJson(set, 'lecture.json');
    const enUrl = lecture.asset.captions.find((c: any) => c.locale_id === 'en_US').url;
    const urls = { lecture: lectureUrl(COURSE_ID, lecture.id), vtt: enUrl };
    const fetchMock = stubFetch({
      [urls.lecture]: () => json(lecture),
      [urls.vtt]: () => text(fixtureText(set, 'captions.vtt')),
      ...overrides(urls),
    });
    return { lecture, enUrl, fetchMock };
  };

  it.each<FixtureSet>(['course-a', 'course-b'])('returns the en_US transcript for %s', async (set) => {
    const { lecture, enUrl, fetchMock } = setup(set);

    const result = await fetchTranscript(COURSE_ID, lecture.id);

    expect(result).toBe(vttToMarkdown(fixtureText(set, 'captions.vtt')));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([lectureUrl(COURSE_ID, lecture.id), enUrl]);
  });

  it('picks en_US out of many locales (course-b: 8th of 10)', async () => {
    const { lecture, fetchMock } = setup('course-b');
    expect(lecture.asset.captions).toHaveLength(10);
    await fetchTranscript(COURSE_ID, lecture.id);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/en_US/');
  });

  it('returns null when the lecture request fails', async () => {
    const { lecture } = setup('course-a', (urls) => ({ [urls.lecture]: () => text('forbidden', 403) }));
    expect(await fetchTranscript(COURSE_ID, lecture.id)).toBeNull();
  });

  it('returns null when the lecture has no captions', async () => {
    stubFetch({ [lectureUrl(COURSE_ID, 1)]: () => json({ asset: { captions: [] } }) });
    expect(await fetchTranscript(COURSE_ID, 1)).toBeNull();
  });

  it('returns null when there is no English track', async () => {
    const lecture = fixtureJson('course-b', 'lecture.json');
    lecture.asset.captions = lecture.asset.captions.filter((c: any) => c.locale_id !== 'en_US');
    stubFetch({ [lectureUrl(COURSE_ID, lecture.id)]: () => json(lecture) });
    expect(await fetchTranscript(COURSE_ID, lecture.id)).toBeNull();
  });

  it('returns null when the VTT request fails', async () => {
    const { lecture, enUrl, fetchMock } = setup('course-a', (urls) => ({ [urls.vtt]: () => text('gone', 410) }));
    expect(await fetchTranscript(COURSE_ID, lecture.id)).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith(enUrl);
  });

  it('returns null when the VTT request throws', async () => {
    const { lecture, enUrl, fetchMock } = setup('course-a', (urls) => ({
      [urls.vtt]: () => {
        throw new TypeError('NetworkError');
      },
    }));
    expect(await fetchTranscript(COURSE_ID, lecture.id)).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith(enUrl);
  });

  // Known bug: only `en_US` actually matches. Udemy's caption objects have no `language`
  // field, so the `language === 'en'` fallback is dead code and en_GB/en_AU-only courses get nothing.
  it.fails('accepts other English locales such as en_GB', async () => {
    const lecture = fixtureJson('course-a', 'lecture.json');
    const caption = lecture.asset.captions[0];
    caption.locale_id = 'en_GB';
    caption.url = caption.url.replace('/en_US/', '/en_GB/');
    stubFetch({
      [lectureUrl(COURSE_ID, lecture.id)]: () => json(lecture),
      [caption.url]: () => text(fixtureText('course-a', 'captions.vtt')),
    });
    expect(await fetchTranscript(COURSE_ID, lecture.id)).toBe(vttToMarkdown(fixtureText('course-a', 'captions.vtt')));
  });
});
