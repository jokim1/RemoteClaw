/**
 * Static Message Component
 *
 * Renders a single message for use inside Ink's <Static> component.
 * Once rendered, these items scroll into terminal scrollback and are
 * never re-rendered by Ink.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../../types.js';
import { getModelAlias } from '../../models.js';

/** Input type for creating static items (before id is assigned). */
export type StaticItemInput =
  | { type: 'message'; message: Message }
  | { type: 'divider'; text: string }
  | { type: 'welcome' };

/** Discriminated union of items that can appear in the Static list. */
export type StaticItem =
  | { type: 'message'; message: Message; id: string }
  | { type: 'divider'; text: string; id: string }
  | { type: 'welcome'; id: string };

/** Render a single completed message (user, assistant, or system). */
export function StaticMessage({ message }: { message: Message }) {
  const speakerName = message.role === 'user'
    ? 'You'
    : message.role === 'system'
      ? 'System'
      : getModelAlias(message.model ?? '');

  const speakerColor = message.role === 'user'
    ? 'green'
    : message.role === 'system'
      ? 'yellow'
      : 'cyan';

  return (
    <Box flexDirection="column">
      <Text color={speakerColor} bold>{speakerName}:</Text>
      <Box paddingLeft={2}>
        <Text wrap="wrap">{message.content || ' '}</Text>
      </Box>
    </Box>
  );
}
