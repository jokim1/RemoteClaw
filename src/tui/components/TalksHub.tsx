/**
 * Talks Hub Component
 *
 * WhatsApp-style saved conversations list.
 * Shows explicitly saved talks (via /save command) sorted by updatedAt.
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Talk, Message, Session } from '../../types';
import type { TalkManager } from '../../services/talks';
import type { SessionManager } from '../../services/sessions';
import { formatRelativeTime, formatSessionTime } from '../utils.js';

interface TalksHubProps {
  talkManager: TalkManager;
  sessionManager: SessionManager;
  maxHeight: number;
  terminalWidth: number;
  onClose: () => void;
  onSelectTalk: (talk: Talk) => void;
}

export function TalksHub({
  talkManager,
  sessionManager,
  maxHeight,
  terminalWidth,
  onClose,
  onSelectTalk,
}: TalksHubProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [renameIndex, setRenameIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const talks = useMemo(() => talkManager.listSavedTalks(), [talkManager, refreshKey]);

  // Calculate visible rows
  const visibleRows = Math.max(3, maxHeight - 4); // title + blank + footer + blank

  const ensureVisible = (idx: number) => {
    setScrollOffset(prev => {
      if (idx < prev) return idx;
      if (idx >= prev + visibleRows) return idx - visibleRows + 1;
      return prev;
    });
  };

  // Get first line preview from session messages
  const getPreview = (talk: Talk): string => {
    const session = sessionManager.getSession(talk.sessionId);
    if (!session || session.messages.length === 0) return 'No messages';
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    if (!firstUserMsg) return 'No messages';
    const preview = firstUserMsg.content.split('\n')[0];
    return preview.length > 40 ? preview.slice(0, 40) + '...' : preview;
  };

  // Keyboard handling
  useInput((input, key) => {
    // ^T always closes
    if (input === 't' && key.ctrl) {
      onClose();
      return;
    }

    // Handle rename mode
    if (renameIndex !== null) {
      if (key.return) {
        const talk = talks[renameIndex];
        if (talk && renameValue.trim()) {
          talkManager.setTopicTitle(talk.id, renameValue.trim());
          setRefreshKey(k => k + 1);
        }
        setRenameIndex(null);
        setRenameValue('');
        return;
      }
      if (key.escape) {
        setRenameIndex(null);
        setRenameValue('');
        return;
      }
      return;
    }

    if (key.escape) {
      onClose();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => {
        const next = Math.max(0, prev - 1);
        ensureVisible(next);
        return next;
      });
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => {
        const next = Math.min(talks.length - 1, prev + 1);
        ensureVisible(next);
        return next;
      });
      return;
    }

    if (key.return && talks.length > 0) {
      const talk = talks[selectedIndex];
      if (talk) {
        onSelectTalk(talk);
      }
      return;
    }

    // 'r' to rename
    if ((input === 'r' || input === 'R') && talks.length > 0) {
      const talk = talks[selectedIndex];
      setRenameIndex(selectedIndex);
      setRenameValue(talk.topicTitle || '');
      return;
    }
  });

  const visibleTalks = talks.slice(scrollOffset, scrollOffset + visibleRows);
  const hasMore = scrollOffset + visibleRows < talks.length;
  const hasLess = scrollOffset > 0;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Saved Talks</Text>
      <Box height={1} />

      {talks.length === 0 ? (
        <Box flexDirection="column">
          <Text dimColor>No saved talks yet.</Text>
          <Text dimColor>Use /save to save the current chat.</Text>
        </Box>
      ) : (
        <>
          {hasLess && <Text dimColor>  {'\u25B2'} more</Text>}
          {visibleTalks.map((talk, i) => {
            const actualIndex = scrollOffset + i;
            const isSelected = actualIndex === selectedIndex;
            const isRenaming = actualIndex === renameIndex;
            const session = sessionManager.getSession(talk.sessionId);
            const msgCount = session?.messages.length ?? 0;

            // Display: Topic Title OR (date/time + first line preview)
            let displayText: React.ReactNode;
            if (isRenaming) {
              displayText = (
                <Box>
                  <Text>Topic: </Text>
                  <TextInput
                    value={renameValue}
                    onChange={setRenameValue}
                    onSubmit={() => {
                      if (renameValue.trim()) {
                        talkManager.setTopicTitle(talk.id, renameValue.trim());
                        setRefreshKey(k => k + 1);
                      }
                      setRenameIndex(null);
                      setRenameValue('');
                    }}
                  />
                </Box>
              );
            } else if (talk.topicTitle) {
              displayText = (
                <Text bold={isSelected}>{talk.topicTitle}</Text>
              );
            } else {
              const sessionTime = formatSessionTime(talk.createdAt);
              const preview = getPreview(talk);
              displayText = (
                <>
                  <Text dimColor>{sessionTime}</Text>
                  <Text> </Text>
                  <Text>{preview}</Text>
                </>
              );
            }

            return (
              <Box key={talk.id}>
                <Text color={isSelected ? 'cyan' : undefined}>
                  {isSelected ? '> ' : '  '}
                  {displayText}
                  <Text dimColor> ({msgCount} msg{msgCount !== 1 ? 's' : ''})</Text>
                </Text>
              </Box>
            );
          })}
          {hasMore && <Text dimColor>  {'\u25BC'} more</Text>}
        </>
      )}

      <Box height={1} />
      {renameIndex !== null ? (
        <Text dimColor>  Enter Save  Esc Cancel</Text>
      ) : (
        <Text dimColor>  {'\u2191\u2193'} Navigate  Enter Continue  r Rename  Esc Close</Text>
      )}
    </Box>
  );
}
