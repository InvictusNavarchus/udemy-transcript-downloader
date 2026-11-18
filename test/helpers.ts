import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type FixtureSet = 'course-a' | 'course-b';

const dir = join(import.meta.dirname, 'fixtures');

export const fixtureText = (set: FixtureSet, file: string): string => readFileSync(join(dir, set, file), 'utf8');
export const fixtureJson = <T = any>(set: FixtureSet, file: string): T => JSON.parse(fixtureText(set, file));
