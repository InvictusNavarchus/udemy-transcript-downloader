import { zip } from 'fflate';
import { UdemyCurriculumItem } from './types';
import { sanitizeFileName, stringToBuffer } from './helpers';

/**
 * Generates a ZIP file containing individual transcript files organized by chapter,
 * plus a merged full transcript file.
 * @param curriculum - Array of curriculum items with markdown content
 * @param courseTitle - The course title for file naming
 * @returns Promise that resolves when ZIP is generated and download triggered
 */
export const generateZip = async (
  curriculum: UdemyCurriculumItem[],
  courseTitle: string
): Promise<void> => {
  const zipData: Record<string, Uint8Array> = {};
  const cleanTitle = sanitizeFileName(courseTitle);

  let mergedContent = `# ${courseTitle}\n\n`;
  let currentChapterDir = '00_Intro';
  let chapterCount = 0;
  let lectureCount = 0;

  for (const item of curriculum) {
    if (item.type === 'chapter') {
      chapterCount++;
      lectureCount = 0; // Reset lecture count per chapter
      const safeTitle = sanitizeFileName(item.title);
      currentChapterDir = `${String(chapterCount).padStart(2, '0')}_${safeTitle}`;
      mergedContent += `\n\n## ${chapterCount}. ${item.title}\n\n`;
    } else if (item.type === 'lecture' && item.markdownContent) {
      lectureCount++;
      const safeTitle = sanitizeFileName(item.title);
      const fileName = `${String(lectureCount).padStart(2, '0')}_${safeTitle}.md`;
      const filePath = `${currentChapterDir}/${fileName}`;

      // Add individual file
      zipData[filePath] = stringToBuffer(item.markdownContent);

      // Append to merged file
      mergedContent += `### ${lectureCount}. ${item.title}\n\n${item.markdownContent}\n\n---\n\n`;
    }
  }

  // Add merged file
  zipData[`${cleanTitle}_Full.md`] = stringToBuffer(mergedContent);

  // Zipping with Promise wrapper for proper async flow
  return new Promise<void>((resolve, reject) => {
    zip(zipData, { level: 6 }, (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      // Trigger Download
      const blob = new Blob([new Uint8Array(data)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanTitle}_Transcripts.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      resolve();
    });
  });
};
