import type { Doc } from './types';

/** 按 maxTokens 预算自动裁剪内容，优先保留 frontmatter 和代码块 */
export function applyTokenBudget(docs: Doc[], budget: number): Doc[] {
  if (docs.length === 0) return [];
  const perDocBudget = Math.floor(budget / docs.length);
  return docs.map(doc => ({
    ...doc,
    content: truncateSmart(doc.content ?? '', perDocBudget)
  }));
}

/** 保留预算内的完整 frontmatter / 代码块，再用剩余预算裁剪描述文本。 */
export function truncateSmart(content: string, budget: number): string {
  budget = Math.floor(budget);
  if (!(budget > 0)) return '';
  if (countTokens(content) <= budget) return content;

  const segments: { text: string; protected: boolean }[] = [];
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  if (frontmatter) segments.push({ text: frontmatter, protected: true });

  // Store actual segments rather than inserting placeholders into prose.
  let cursor = frontmatter?.length ?? 0;
  const opening = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gm;
  opening.lastIndex = cursor;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(content))) {
    if (match.index > cursor) {
      segments.push({ text: content.slice(cursor, match.index), protected: false });
    }
    const fence = match[1];
    const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\r?\\n|$)`, 'gm');
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(content);
    cursor = end ? closing.lastIndex : content.length;
    segments.push({ text: content.slice(match.index, cursor), protected: true });
    opening.lastIndex = cursor;
  }
  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor), protected: false });
  }

  // Reserve complete protected segments first, including joining newlines.
  const selected = new Map<number, string>();
  let remaining = budget;
  for (const [index, segment] of segments.entries()) {
    if (!segment.protected) continue;
    const cost = countTokens(segment.text + '\n');
    if (cost <= remaining) {
      selected.set(index, segment.text);
      remaining -= cost;
    }
  }

  for (const [index, segment] of segments.entries()) {
    if (segment.protected || remaining <= 1) continue;
    const text = truncateText(segment.text, remaining - 1);
    if (!text) continue;
    selected.set(index, text);
    remaining -= countTokens(text + '\n');
  }

  return [...selected.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text)
    .join('\n');
}

/** 使用与 countTokens 相同的字符权重，避免截断 Unicode 码点。 */
function truncateText(text: string, budget: number): string {
  let units = 0;
  let end = 0;
  for (const character of text) {
    const cost = /[一-龥]/.test(character) ? 4 : character.length;
    if (units + cost > budget * 4) break;
    units += cost;
    end += character.length;
  }
  return text.slice(0, end);
}

export function countTokens(text: string): number {
  // 简单估算：中文字符 ≈ 1 token，英文/符号 ≈ 4 字符 ≈ 1 token
  const chinese = (text.match(/[一-龥]/g) ?? []).length;
  const other = text.length - chinese;
  return chinese + Math.ceil(other / 4);
}
