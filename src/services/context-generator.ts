/**
 * Context Generator
 *
 * Generates markdown context summaries for Talks.
 * This is a simple text-based summary (no AI) that captures key conversation info.
 */

import type { Talk, Message } from '../types';

/**
 * Generate a markdown context summary for a talk.
 * This context is invisible to the user but can be used for AI context recovery.
 */
export function generateContextMd(talk: Talk, messages: Message[]): string {
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  const userMessages = nonSystemMessages.filter(m => m.role === 'user');
  const assistantMessages = nonSystemMessages.filter(m => m.role === 'assistant');

  const createdDate = new Date(talk.createdAt).toLocaleString();
  const updatedDate = new Date(talk.updatedAt).toLocaleString();
  const topicTitle = talk.topicTitle || 'Untitled';

  // Get recent messages for summary (last 10 non-system messages)
  const recentMessages = nonSystemMessages.slice(-10);
  const recentSummary = recentMessages
    .map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      const content = m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content;
      return `**${role}:** ${content}`;
    })
    .join('\n\n');

  // Extract potential topics from user messages (simple keyword extraction)
  const allUserText = userMessages.map(m => m.content).join(' ');
  const words = allUserText.toLowerCase().split(/\s+/);
  const wordFreq = new Map<string, number>();
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'or', 'and', 'but', 'if', 'then', 'else', 'when', 'up', 'out', 'no', 'not', 'so', 'what', 'which', 'who', 'how', 'this', 'that', 'these', 'those', 'it', 'its', 'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'their', 'them', 'he', 'she', 'him', 'her', 'his']);

  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '');
    if (clean.length > 3 && !stopWords.has(clean)) {
      wordFreq.set(clean, (wordFreq.get(clean) || 0) + 1);
    }
  }

  const topKeywords = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  const keywordsSection = topKeywords.length > 0
    ? `\n## Keywords\n${topKeywords.join(', ')}`
    : '';

  return `# Talk Context

## Metadata
- **Topic:** ${topicTitle}
- **Created:** ${createdDate}
- **Last Active:** ${updatedDate}
- **Total Messages:** ${nonSystemMessages.length}
- **User Messages:** ${userMessages.length}
- **Assistant Messages:** ${assistantMessages.length}
${keywordsSection}

## Recent Messages
${recentSummary || '*No messages yet*'}
`;
}
