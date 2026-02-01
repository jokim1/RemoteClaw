/**
 * Shared helper functions for the TUI layer
 */

import { randomUUID } from 'crypto';
import type { Message } from '../types.js';
import { INPUT_CLEANUP_DELAY_MS } from '../constants.js';

/** Create a Message object with a unique ID and current timestamp. */
export function createMessage(
  role: Message['role'],
  content: string,
  model?: string,
): Message {
  return {
    id: randomUUID(),
    role,
    content,
    timestamp: Date.now(),
    ...(model ? { model } : {}),
  };
}

/** Remove leaked control characters from the input field (Ink workaround). */
export function cleanInputChar(
  setter: (fn: (prev: string) => string) => void,
  char: string,
): void {
  setTimeout(() => {
    setter(prev => prev.replace(new RegExp(char, 'g'), ''));
  }, INPUT_CLEANUP_DELAY_MS);
}
