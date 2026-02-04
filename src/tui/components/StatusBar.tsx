/**
 * Status Bar Component
 *
 * Nano-style: info at top, shortcuts at bottom
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { UsageStats, ModelStatus, VoiceMode, VoiceReadiness } from '../../types';
import type { TailscaleStatus } from '../../services/tailscale';
import type { BillingOverride } from '../../config.js';
import { getModelAlias } from '../../models.js';

function formatResetTime(isoTimestamp: string): string {
  const now = Date.now();
  const reset = new Date(isoTimestamp).getTime();
  const diffMs = reset - now;

  if (diffMs <= 0) return 'now';

  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

interface StatusBarProps {
  model: string;
  modelStatus?: ModelStatus;
  usage: UsageStats;
  gatewayStatus: 'online' | 'offline' | 'connecting';
  tailscaleStatus: TailscaleStatus | 'checking';
  billing?: BillingOverride;
  sessionName?: string;
  terminalWidth?: number;
  voiceMode?: VoiceMode;
  voiceReadiness?: VoiceReadiness;
  ttsEnabled?: boolean;
}

export function StatusBar({ model, modelStatus, usage, gatewayStatus, tailscaleStatus, billing, sessionName, terminalWidth = 80, voiceMode, voiceReadiness, ttsEnabled = true }: StatusBarProps) {
  const modelName = getModelAlias(model);
  const modelIndicator = modelStatus === 'checking' ? ' ◐' : '';
  const isSubscription = billing?.mode === 'subscription';

  // Status icons (no colors - using fixed-width text rendering for stability)
  const gwIcon = gatewayStatus === 'online' ? '●' : gatewayStatus === 'connecting' ? '◐' : '○';
  const tsIcon = tailscaleStatus === 'connected' ? '●' : '○';
  const micIcon = voiceReadiness === 'ready' ? '●' : voiceReadiness === 'checking' ? '◐' : '○';
  const isVoiceActive = voiceMode === 'playing' || voiceMode === 'synthesizing';
  const ttsIcon = isVoiceActive ? (voiceMode === 'playing' ? '♪' : '◐') : ttsEnabled ? '●' : '○';

  // Build cost/billing section
  let billingText = '';
  if (isSubscription) {
    const rl = usage.rateLimits;
    const primary = rl?.weekly ?? rl?.session;
    if (primary) {
      const pct = primary.limit > 0 ? Math.round((primary.used / primary.limit) * 100) : 0;
      const filled = Math.min(10, Math.round((pct / 100) * 10));
      const resetLabel = formatResetTime(primary.resetsAt);
      const windowLabel = rl?.weekly ? 'wk' : 'sess';
      const pausedText = pct >= 100 ? ' PAUSED' : '';
      billingText = `${billing?.plan ?? 'Sub'} ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${pct}% ${windowLabel}${pausedText} Resets ${resetLabel}`;
    } else {
      billingText = `${billing?.plan ?? 'Sub'} $${billing?.monthlyPrice ?? '?'}/mo`;
    }
  } else {
    const hasApiCost = usage.modelPricing !== undefined;
    const parts = [];
    if (hasApiCost) parts.push(`$${usage.modelPricing!.inputPer1M}/$${usage.modelPricing!.outputPer1M}`);
    parts.push(`Today $${(usage.todaySpend ?? 0).toFixed(2)}`);
    parts.push(`Wk $${(usage.weeklySpend ?? 0).toFixed(2)}`);
    parts.push(`~Mo $${Math.round(usage.monthlyEstimate ?? 0)}`);
    if ((usage.sessionCost ?? 0) > 0) parts.push(`Sess $${(usage.sessionCost ?? 0).toFixed(2)}`);
    billingText = parts.join('  ');
  }

  // Build fixed-width lines to prevent layout recalculation
  const leftPart = `GW:${gwIcon} TS:${tsIcon} M:${modelName}${modelIndicator}  ${billingText}`;
  const rightPart = `V:${ttsIcon} Mic:${micIcon}  ${sessionName ?? ''}`;
  const gap = Math.max(2, terminalWidth - leftPart.length - rightPart.length - 2);

  // Create exact-width string (prevents Yoga from recalculating layout)
  let statusLine = ' ' + leftPart + ' '.repeat(gap) + rightPart + ' ';
  if (statusLine.length > terminalWidth) {
    statusLine = statusLine.slice(0, terminalWidth);
  } else if (statusLine.length < terminalWidth) {
    statusLine = statusLine + ' '.repeat(terminalWidth - statusLine.length);
  }

  const separator = '─'.repeat(terminalWidth);

  // Render with fixed content - no dynamic layout
  return (
    <Box flexDirection="column" width={terminalWidth} height={3}>
      <Box height={1} />
      <Box height={1}>
        <Text dimColor>{statusLine}</Text>
      </Box>
      <Box height={1}>
        <Text dimColor>{separator}</Text>
      </Box>
    </Box>
  );
}

interface ShortcutBarProps {
  terminalWidth?: number;
  ttsEnabled?: boolean;
}

export function ShortcutBar({ terminalWidth = 80, ttsEnabled = true }: ShortcutBarProps) {
  const shortcuts = [
    { key: '^T', label: 'Talks' },
    { key: '^C', label: 'Chat' },
    { key: '^P', label: 'PTT' },
    { key: '^V', label: ttsEnabled ? 'Voice OFF' : 'Voice ON' },
    { key: '^H', label: 'History' },
    { key: '^S', label: 'Settings' },
    { key: '^X', label: 'Exit' },
  ];

  // Build fixed-width shortcut line
  const shortcutText = shortcuts.map(s => `[${s.key}] ${s.label}`).join('  ');
  let shortcutLine = ' ' + shortcutText;
  if (shortcutLine.length < terminalWidth) {
    shortcutLine = shortcutLine + ' '.repeat(terminalWidth - shortcutLine.length);
  } else {
    shortcutLine = shortcutLine.slice(0, terminalWidth);
  }

  const separator = '─'.repeat(terminalWidth);

  return (
    <Box flexDirection="column" width={terminalWidth} height={2}>
      <Box height={1}>
        <Text dimColor>{separator}</Text>
      </Box>
      <Box height={1}>
        <Text dimColor>{shortcutLine}</Text>
      </Box>
    </Box>
  );
}
