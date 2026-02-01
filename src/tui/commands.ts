/**
 * Slash command registry
 *
 * Extensible command pattern: add new slash commands by adding
 * entries to the COMMANDS map without modifying the submit handler.
 */

import { ALIAS_TO_MODEL_ID } from '../models.js';

export interface CommandContext {
  switchModel: (modelId: string) => void;
  openModelPicker: () => void;
  clearSession: () => void;
  setError: (error: string | null) => void;
}

export interface CommandResult {
  handled: true;
}

type CommandHandler = (args: string, ctx: CommandContext) => CommandResult;

/** Handle /model <alias|id> — switch the active model. */
function handleModelCommand(args: string, ctx: CommandContext): CommandResult {
  if (!args) {
    ctx.openModelPicker();
    return { handled: true };
  }

  const resolvedModel = ALIAS_TO_MODEL_ID[args.toLowerCase()] ?? args;
  ctx.switchModel(resolvedModel);
  return { handled: true };
}

/** Handle /clear — clear the current session. */
function handleClearCommand(_args: string, ctx: CommandContext): CommandResult {
  ctx.clearSession();
  return { handled: true };
}

/**
 * Registry of slash commands.
 * Add new commands here — they'll be available immediately.
 */
const COMMANDS: Record<string, CommandHandler> = {
  model: handleModelCommand,
  clear: handleClearCommand,
};

/**
 * Try to dispatch a slash command. Returns true if the input was handled.
 */
export function dispatchCommand(input: string, ctx: CommandContext): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return false;

  const withoutSlash = trimmed.slice(1);

  // Check explicit commands (e.g. /model, /clear)
  for (const [name, handler] of Object.entries(COMMANDS)) {
    if (withoutSlash === name || withoutSlash.startsWith(name + ' ')) {
      const args = withoutSlash.slice(name.length).trim();
      handler(args, ctx);
      return true;
    }
  }

  // Check bare alias commands (e.g. /opus, /deep, /sonnet)
  const alias = withoutSlash.toLowerCase();
  const aliasModel = ALIAS_TO_MODEL_ID[alias];
  if (aliasModel) {
    ctx.switchModel(aliasModel);
    return true;
  }

  return false;
}
