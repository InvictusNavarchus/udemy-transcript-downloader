# Fixtures

Trimmed snapshots of real Udemy responses, captured on 2026-11-18 with
`scripts/smoke-test.js` (`copy(__udemyFixtures)`).

These are dated samples of what Udemy returned, not a live contract. When the
smoke test shows Udemy changed a format, add a new fixture set next to these
instead of replacing them: the code should keep handling every format seen.

Each set has `curriculum.json` (subscriber-curriculum-items), `lecture.json`
(lecture asset captions) and `captions.vtt`. They are deliberately small: a few
lectures and cues, and the signed caption URLs are redacted.

| Set | Captions | VTT format |
|---|---|---|
| `course-a` | One manual `en_US` track | Numbered cues, `HH:MM:SS.mmm` timestamps |
| `course-b` | 10 auto tracks, `en_US` is 8th | No cue IDs, `MM:SS.mmm` timestamps, sentence split across cues |
