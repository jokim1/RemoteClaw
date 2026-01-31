/**
 * Transcript View Component
 * 
 * Shows full conversation history with export option
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import type { Message } from '../../types';

interface TranscriptViewProps {
  messages: Message[];
  sessionName: string;
  onClose: () => void;
}

export function TranscriptView({ messages, sessionName, onClose }: TranscriptViewProps) {
  const [exported, setExported] = useState<string | null>(null);
  
  useInput((input, key) => {
    if (key.escape || (input === 't' && key.ctrl)) {
      onClose();
      return;
    }
    
    if (input === 'e' || input === 'E') {
      // Export to file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `transcript-${sessionName.replace(/\s+/g, '-')}-${timestamp}.txt`;
      const filepath = path.join(process.env.HOME || '~', filename);
      
      let content = `Transcript: ${sessionName}\n`;
      content += `Exported: ${new Date().toLocaleString()}\n`;
      content += `Messages: ${messages.length}\n`;
      content += '─'.repeat(50) + '\n\n';
      
      for (const msg of messages) {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        const role = msg.role === 'user' ? 'You' : 'AI';
        content += `[${time}] ${role}:\n${msg.content}\n\n`;
      }
      
      try {
        fs.writeFileSync(filepath, content);
        setExported(filepath);
      } catch (err) {
        setExported(`Error: ${err instanceof Error ? err.message : 'Failed to export'}`);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Transcript - {sessionName} ({messages.length} messages)</Text>
      <Text dimColor>Press E to export to file, Esc or ^T to close</Text>
      {exported ? (
        <Text color={exported.startsWith('Error') ? 'red' : 'green'}>{exported}</Text>
      ) : null}
      <Box height={1} />
      
      {messages.length === 0 ? (
        <Text dimColor>No messages in this session.</Text>
      ) : (
        messages.slice(-20).map((msg, index) => {
          const time = new Date(msg.timestamp).toLocaleTimeString();
          const role = msg.role === 'user' ? 'You' : 'AI';
          const roleColor = msg.role === 'user' ? 'green' : 'cyan';
          
          return (
            <Box key={msg.id || index} flexDirection="column" marginBottom={1}>
              <Text>
                <Text dimColor>[{time}] </Text>
                <Text color={roleColor} bold>{role}:</Text>
              </Text>
              <Box paddingLeft={2}>
                <Text wrap="wrap">{msg.content.slice(0, 200)}{msg.content.length > 200 ? '...' : ''}</Text>
              </Box>
            </Box>
          );
        })
      )}
      
      {messages.length > 20 ? (
        <Text dimColor>... showing last 20 of {messages.length} messages. Export for full transcript.</Text>
      ) : null}
    </Box>
  );
}
