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

export const vttToMarkdown = (vttRaw: string): string => {
  if (!vttRaw) return '';
  
  const lines = vttRaw.split('\n');
  let cleanText = '';
  const timestampRegex = /^\d{2}:\d{2}/;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed === 'WEBVTT') return;
    if (timestampRegex.test(trimmed)) return;
    if (trimmed === '') return;
    if (trimmed.includes('-->')) return;
    
    cleanText += `${trimmed} `;
  });

  return cleanText.replace(/\s+/g, ' ').trim();
};

export const stringToBuffer = (str: string) => strToU8(str);