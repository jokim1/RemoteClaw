/**
 * Input Area Component
 *
 * Simple text input with > prompt
 */

import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled: boolean;
}

export function InputArea({ value, onChange, onSubmit }: InputAreaProps) {
  return (
    <Box paddingX={1}>
      <Text color="green">&gt; </Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
    </Box>
  );
}
