/**
 * Chat View Component
 *
 * This component only renders the "live" area:
 * - Streaming content during AI response
 * - Welcome message before first interaction
 *
 * Completed messages are written directly to terminal scrollback
 * by the parent component using messageWriter.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../../types';

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
 * Truncate text to fit within maxLines.
 */
function truncateToLines(text: string, maxLines: number, width: number): string {
  if (!text || maxLines <= 0) return '';

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

  return lines.slice(0, maxLines).join('\n');
}

/** Count visual lines */
function countLines(text: string, width: number): number {
  if (!text) return 1;
  const usableWidth = Math.max(10, width - 6);
  let count = 0;
  for (const line of text.split('\n')) {
    count += Math.max(1, Math.ceil(line.length / usableWidth));
  }
  return count;
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
  const hasUserInput = messages.some(m => m.role === 'user');
  const systemMessages = messages.filter(m => m.role === 'system');

  // Calculate streaming area size
  const streamingMaxLines = Math.max(3, maxHeight - 2);
  const truncatedStreaming = useMemo(() => {
    if (!streamingContent) return '';
    return truncateToLines(streamingContent, streamingMaxLines, terminalWidth);
  }, [streamingContent, streamingMaxLines, terminalWidth]);

  // Welcome screen - before any user input
  if (!hasUserInput && !isProcessing) {
    return (
      <Box flexDirection="column" height={maxHeight}>
        <Text dimColor>Welcome to RemoteClaw by Opus4.5 and Joseph Kim (@jokim1)</Text>
        <Text dimColor>Type a message to start chatting.</Text>
        <Text> </Text>
        <Text dimColor>Scroll up in your terminal to see full chat history.</Text>
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

  // Active chat - only show streaming content
  // Completed messages are in terminal scrollback (scroll up to see)
  return (
    <Box flexDirection="column" height={maxHeight}>
      {isProcessing ? (
        // Show streaming response
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
      ) : (
        // Not processing - hint to scroll up
        <Box flexDirection="column">
          <Text dimColor>↑ Scroll up in terminal to see chat history</Text>
        </Box>
      )}
    </Box>
  );
}
