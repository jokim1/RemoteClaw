/**
 * Chat View Component
 *
 * Displays messages in a fixed viewport with:
 * - Recent messages shown (as many as fit)
 * - Streaming content during processing
 * - Content pre-truncated to prevent overflow
 * - Use ^H History to view full message history
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../../types';
import { getModelAlias } from '../../models.js';

interface ChatViewProps {
  messages: Message[];
  isProcessing: boolean;
  streamingContent?: string;
  modelAlias?: string;
  maxHeight?: number;
  terminalWidth?: number;
  scrollOffset?: number;
  onScroll?: (offset: number) => void;
  isActive?: boolean;
}

/**
 * Truncate text to fit within maxLines at given width.
 */
function truncateToLines(text: string, maxLines: number, width: number): { text: string; truncated: boolean } {
  if (!text || maxLines <= 0) return { text: '', truncated: false };

  const usableWidth = Math.max(10, width - 6);
  const lines: string[] = [];

  for (const para of text.split('\n')) {
    if (lines.length >= maxLines) break;

    if (!para) {
      lines.push('');
      continue;
    }

    let remaining = para;
    while (remaining.length > 0 && lines.length < maxLines) {
      lines.push(remaining.slice(0, usableWidth));
      remaining = remaining.slice(usableWidth);
    }
  }

  const result = lines.slice(0, maxLines).join('\n');
  const truncated = result.length < text.length;
  return { text: result, truncated };
}

/** Count visual lines text will occupy */
function countLines(text: string, width: number): number {
  if (!text) return 1;
  const usableWidth = Math.max(10, width - 6);
  let count = 0;
  for (const line of text.split('\n')) {
    count += Math.max(1, Math.ceil(line.length / usableWidth));
  }
  return count;
}

/** Render a message */
function MessageItem({
  msg,
  maxContentLines,
  width,
}: {
  msg: Message;
  maxContentLines?: number;
  width: number;
}) {
  const speakerName = msg.role === 'user'
    ? 'You'
    : msg.role === 'system'
      ? 'System'
      : getModelAlias(msg.model ?? '');
  const speakerColor = msg.role === 'user' ? 'green' : msg.role === 'system' ? 'yellow' : 'cyan';

  let displayContent = msg.content || ' ';
  let wasTruncated = false;

  if (maxContentLines !== undefined && maxContentLines > 0) {
    const result = truncateToLines(msg.content, maxContentLines, width);
    displayContent = result.text || ' ';
    wasTruncated = result.truncated;
  }

  return (
    <Box flexDirection="column">
      <Text color={speakerColor} bold>{speakerName}:</Text>
      <Box paddingLeft={2}>
        <Text wrap="wrap">{displayContent}{wasTruncated ? <Text dimColor>...</Text> : null}</Text>
      </Box>
    </Box>
  );
}

export function ChatView({
  messages,
  isProcessing,
  streamingContent,
  modelAlias,
  maxHeight = 20,
  terminalWidth = 80,
}: ChatViewProps) {
  const currentAiName = modelAlias || 'AI';

  // Calculate available space
  const streamingLines = isProcessing
    ? Math.min(10, 1 + countLines(streamingContent || 'thinking...', terminalWidth))
    : 0;
  const indicatorLine = 1;
  const availableForMessages = Math.max(2, maxHeight - indicatorLine - streamingLines);

  // Build visible messages - work backwards from most recent
  const visibleData = useMemo(() => {
    if (messages.length === 0) return { items: [] as Array<{ msg: Message; maxContentLines: number }>, hiddenCount: 0 };

    const items: Array<{ msg: Message; maxContentLines: number }> = [];
    let linesRemaining = availableForMessages;

    for (let i = messages.length - 1; i >= 0 && linesRemaining > 1; i--) {
      const msg = messages[i];
      const contentLines = countLines(msg.content, terminalWidth);
      const headerLine = 1;
      const totalLines = headerLine + contentLines;

      if (totalLines <= linesRemaining) {
        items.unshift({ msg, maxContentLines: contentLines });
        linesRemaining -= totalLines;
      } else if (linesRemaining > headerLine + 1) {
        const availableContent = linesRemaining - headerLine;
        items.unshift({ msg, maxContentLines: availableContent });
        linesRemaining = 0;
      } else {
        break;
      }
    }

    return { items, hiddenCount: messages.length - items.length };
  }, [messages, availableForMessages, terminalWidth]);

  // Truncate streaming content
  const streamingMaxLines = Math.max(2, streamingLines - 1);
  const truncatedStreaming = useMemo(() => {
    if (!streamingContent) return '';
    return truncateToLines(streamingContent, streamingMaxLines, terminalWidth).text;
  }, [streamingContent, streamingMaxLines, terminalWidth]);

  // Welcome screen
  const hasUserInput = messages.some(m => m.role === 'user');
  const systemMessages = messages.filter(m => m.role === 'system');

  if (!hasUserInput && !isProcessing) {
    return (
      <Box flexDirection="column" height={maxHeight}>
        <Text dimColor>Welcome to RemoteClaw by Opus4.5 and Joseph Kim (@jokim1)</Text>
        <Text dimColor>Type a message to start chatting.</Text>
        <Text> </Text>
        <Text dimColor>Use ^H History to view full chat history.</Text>
        <Text> </Text>
        <Text dimColor>^T Talks  ^N New  ^C Chat  ^P PTT  ^V Voice  ^H History  ^S Settings</Text>
        <Text> </Text>
        {systemMessages.map((msg) => (
          <Box key={msg.id}>
            <Text color="yellow">{msg.content}</Text>
          </Box>
        ))}
      </Box>
    );
  }

  // Chat view
  return (
    <Box flexDirection="column" height={maxHeight}>
      {/* Hidden messages indicator */}
      {visibleData.hiddenCount > 0 && (
        <Text dimColor>  ▲ {visibleData.hiddenCount} earlier message{visibleData.hiddenCount !== 1 ? 's' : ''} (^H History)</Text>
      )}
      {visibleData.hiddenCount === 0 && messages.length > 0 && <Text> </Text>}

      {/* Visible messages */}
      {visibleData.items.map(({ msg, maxContentLines }) => (
        <Box key={msg.id}>
          <MessageItem msg={msg} maxContentLines={maxContentLines} width={terminalWidth} />
        </Box>
      ))}

      {/* Streaming response */}
      {isProcessing && (
        <Box flexDirection="column">
          <Text color="cyan" bold>{currentAiName}:</Text>
          <Box paddingLeft={2}>
            {truncatedStreaming ? (
              <Text wrap="wrap">{truncatedStreaming}<Text color="cyan">▌</Text></Text>
            ) : (
              <Text color="gray">thinking...</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
