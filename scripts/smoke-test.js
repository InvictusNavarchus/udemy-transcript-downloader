// Udemy smoke test — verifies Udemy's side of the contract the extension relies on.
//
// Usage: open any lecture page (https://www.udemy.com/course/*/learn/lecture/*),
// paste this whole file into the DevTools console, and read the resulting table.
// Responses are stored in `window.__udemyFixtures`; run `copy(__udemyFixtures)` to
// copy them (strip the signed caption URLs before committing them anywhere).
//
// Keep the URLs and checks in sync with src/utils/udemy-api.ts.
(async () => {
	const rows = [];
	const log = (check, status, detail = '') => rows.push({ check, status, detail: String(detail) });
	const ok = (check, cond, detail) => {
		log(check, cond ? 'PASS' : 'FAIL', detail);
		return cond;
	};
	const fixtures = {};

	try {
		// 1. DOM hook (getCourseId)
		const el = document.querySelector('[data-module-id="course-taking"]');
		if (!ok('DOM hook [data-module-id="course-taking"]', !!el)) return;
		const args = JSON.parse(el.getAttribute('data-module-args') || '{}');
		const courseId = args.courseId;
		if (!ok('courseId is a number', typeof courseId === 'number', courseId)) return;

		// 2. Curriculum API (fetchCurriculum)
		const curRes = await fetch(
			`https://www.udemy.com/api-2.0/courses/${courseId}/subscriber-curriculum-items/?curriculum_types=chapter%2Clecture%2Cquiz&page_size=1000&fields%5Blecture%5D=title%2Casset&fields%5Bchapter%5D=title`,
		);
		if (!ok('curriculum HTTP', curRes.ok, curRes.status)) return;
		const cur = await curRes.json();
		fixtures.curriculum = cur;
		const items = cur.results ?? [];
		ok('curriculum.results is array', Array.isArray(cur.results), `${items.length} items (count=${cur.count})`);
		log(
			'pagination (next)',
			cur.next ? 'INFO' : 'PASS',
			cur.next ? `more pages follow (only the first is checked): ${cur.next}` : 'none',
		);
		const classes = [...new Set(items.map((i) => i._class))];
		ok(
			'_class values known',
			classes.every((c) => ['chapter', 'lecture', 'quiz'].includes(c)),
			classes.join(', '),
		);
		const assetTypes = [...new Set(items.filter((i) => i._class === 'lecture').map((i) => i.asset?.asset_type))];
		log('lecture asset types', 'INFO', assetTypes.join(', '));
		const videos = items.filter((i) => i._class === 'lecture' && i.asset?.asset_type === 'Video');
		if (!ok('found Video lectures', videos.length > 0, videos.length)) return;

		// 2b. Pagination contract (fetchCurriculum follows `next`)
		// Force tiny pages so any course with more than 2 items has a second page, and check that
		// `next` is an absolute API URL that keeps the field selection.
		const smallRes = await fetch(
			`https://www.udemy.com/api-2.0/courses/${courseId}/subscriber-curriculum-items/?curriculum_types=chapter%2Clecture%2Cquiz&page_size=2&fields%5Blecture%5D=title%2Casset&fields%5Bchapter%5D=title`,
		);
		const small = smallRes.ok ? await smallRes.json() : null;
		if (!small?.next) {
			log(
				'pagination: next link',
				small ? 'WARN' : 'FAIL',
				small ? `no next with page_size=2 (count=${small.count}); not checked` : smallRes.status,
			);
		} else {
			ok('pagination: next is absolute API URL', small.next.startsWith('https://www.udemy.com/api-2.0/'), small.next);
			ok('pagination: next keeps fields', small.next.includes('fields%5Blecture%5D=title%2Casset'), small.next);
			const page2Res = await fetch(small.next);
			const page2 = page2Res.ok ? await page2Res.json() : null;
			if (ok('pagination: page 2 HTTP', page2Res.ok, page2Res.status)) {
				const lectures = (page2.results ?? []).filter((i) => i._class === 'lecture');
				ok(
					'pagination: page 2 lectures keep asset field',
					lectures.every((i) => 'asset' in i),
					`${lectures.length} lectures`,
				);
			}
		}

		// 3. Captions API (fetchTranscript)
		// A lecture without English captions is a normal outcome (fetchTranscript returns null),
		// not an API contract failure, so try a few lectures. The cap keeps the request count low
		// on courses that have no English captions at all.
		const MAX_LECTURES = 5;
		let en;
		for (const video of videos.slice(0, MAX_LECTURES)) {
			const lecRes = await fetch(
				`https://www.udemy.com/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${video.id}/?fields%5Blecture%5D=asset&fields%5Basset%5D=captions`,
			);
			if (!ok('lecture HTTP', lecRes.ok, `${lecRes.status} (${video.title})`)) return;
			const lec = await lecRes.json();
			fixtures.lecture = lec;
			const captions = lec?.asset?.captions;
			if (!ok('asset.captions is array', Array.isArray(captions), `${captions?.length} (${video.title})`)) return;
			log('caption locales', 'INFO', captions.map((c) => `${c.locale_id}/${c.source}`).join(', ') || 'none');
			// Same rule as pickCaption: any English locale, manual before auto.
			const english = captions.filter((c) => c.url && c.locale_id?.split('_')[0]?.toLowerCase() === 'en');
			en = english.find((c) => c.source === 'manual') ?? english[0];
			if (en?.url) break;
		}
		if (!en?.url) {
			log(
				'English caption selected',
				'WARN',
				`none in the first ${Math.min(videos.length, MAX_LECTURES)} Video lectures; VTT checks skipped`,
			);
			return;
		}
		ok('English caption selected', true, `${en.locale_id}/${en.source}`);

		// 4. VTT download
		const vttRes = await fetch(en.url);
		if (!ok('VTT HTTP', vttRes.ok, vttRes.status)) return;
		const vtt = await vttRes.text();
		fixtures.vtt = vtt;
		ok('VTT header', vtt.trimStart().startsWith('WEBVTT'));
		ok('VTT has cues', vtt.includes('-->'), `${vtt.length} chars`);
	} catch (e) {
		log('unexpected error', 'FAIL', e.message);
	} finally {
		console.table(rows);
		window.__udemyFixtures = fixtures;
		console.log('Fixtures saved to window.__udemyFixtures. Run copy(__udemyFixtures) to copy them.');
	}
})();
