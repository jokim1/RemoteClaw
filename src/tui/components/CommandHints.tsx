/**
 * CommandHints Component
 *
 * Compact autocomplete popup that appears above the input when
 * the user types "/". Shows matching commands with descriptions,
 * filters in real-time as the user types.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { CommandInfo } from '../commands.js';

interface CommandHintsProps {
  commands: CommandInfo[];
  selectedIndex: number;
  width: number;
}

export function CommandHints({ commands, selectedIndex, width }: CommandHintsProps) {
  if (commands.length === 0) return null;

  // Column layout: "/name" left-aligned, description right-dimmed
  const maxNameLen = Math.max(...commands.map(c => c.name.length)) + 1; // +1 for "/"
  const descWidth = Math.max(10, width - maxNameLen - 6); // padding + gap

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={0}>
        <Text dimColor>{'─'.repeat(Math.min(40, width - 2))}</Text>
      </Box>
      {commands.map((cmd, i) => {
        const isSelected = i === selectedIndex;
        const desc = cmd.description.length > descWidth
          ? cmd.description.slice(0, descWidth - 1) + '\u2026'
          : cmd.description;

        return (
          <Box key={cmd.name}>
            <Text
              color={isSelected ? 'cyan' : undefined}
              bold={isSelected}
            >
              {isSelected ? '> ' : '  '}
              /{cmd.name}
            </Text>
            <Text>{'  '}</Text>
            <Text dimColor={!isSelected} color={isSelected ? 'cyan' : undefined}>
              {desc}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
