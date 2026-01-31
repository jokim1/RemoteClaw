/**
 * Status Bar Component
 *
 * Nano-style: info at top, shortcuts at bottom
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { UsageStats } from '../../types';
import { getModelAlias } from '../../models.js';

interface StatusBarProps {
  model: string;
  usage: UsageStats;
  gatewayStatus: 'online' | 'offline' | 'connecting';
  sessionName?: string;
  terminalWidth?: number;
}

export function StatusBar({ model, usage, gatewayStatus, sessionName, terminalWidth = 80 }: StatusBarProps) {
  const modelName = getModelAlias(model);

  const isAnthropicModel = model.startsWith('anthropic/');

  const gateway = gatewayStatus === 'online' ? '●' : gatewayStatus === 'connecting' ? '◐' : '○';
  const gatewayColor = gatewayStatus === 'online' ? 'green' : gatewayStatus === 'connecting' ? 'yellow' : 'red';

  const hasQuota = usage.quotaUsed !== undefined && usage.quotaTotal !== undefined;
  const quotaPercent = hasQuota ? Math.round((usage.quotaUsed! / usage.quotaTotal!) * 100) : 0;
  const quotaRemaining = hasQuota ? usage.quotaTotal! - usage.quotaUsed! : 0;

  const todayCost = usage.todaySpend !== undefined ? `$${usage.todaySpend.toFixed(2)}` : '$0.00';
  const avgCost = usage.averageDailySpend !== undefined ? `$${usage.averageDailySpend.toFixed(2)}` : '$0.00';

  const hasApiCost = usage.modelPricing !== undefined && !isAnthropicModel;
  const apiCost = hasApiCost
    ? `$${usage.modelPricing!.inputPer1M}/$${usage.modelPricing!.outputPer1M} per 1M`
    : null;

  return (
    <Box flexDirection="column" width="100%">
      <Box paddingX={1} justifyContent="space-between">
        <Box>
          <Text color={gatewayColor}>{gateway} </Text>
          <Text color="cyan" bold>{modelName}</Text>

          {isAnthropicModel ? (
            hasQuota ? (
              <>
                <Text dimColor>  Max: </Text>
                <Text color={quotaPercent > 80 ? 'yellow' : undefined}>{quotaPercent}% used</Text>
                <Text dimColor> ({quotaRemaining.toLocaleString()} left)</Text>
              </>
            ) : (
              <>
                <Text dimColor>  Max: </Text>
                <Text>Unlimited</Text>
              </>
            )
          ) : (
            <>
              {hasApiCost ? (
                <>
                  <Text dimColor>  API: </Text>
                  <Text>{apiCost}</Text>
                </>
              ) : null}
              <Text dimColor>  Today: </Text>
              <Text>{todayCost}</Text>
              <Text dimColor> (Avg {avgCost})</Text>
            </>
          )}
        </Box>

        <Box>
          {sessionName ? (
            <Text dimColor>{sessionName}</Text>
          ) : null}
        </Box>
      </Box>

      <Box>
        <Text dimColor>{'─'.repeat(Math.max(1, terminalWidth))}</Text>
      </Box>
    </Box>
  );
}

interface ShortcutBarProps {
  terminalWidth?: number;
}

export function ShortcutBar({ terminalWidth = 80 }: ShortcutBarProps) {
  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text dimColor>{'─'.repeat(Math.max(1, terminalWidth))}</Text>
      </Box>

      <Box paddingX={1} justifyContent="space-between">
        <Box>
          <Text inverse> ^Q </Text>
          <Text> Model  </Text>
        </Box>
        <Box>
          <Text inverse> ^N </Text>
          <Text> New  </Text>
        </Box>
        <Box>
          <Text inverse> ^L </Text>
          <Text> Clear  </Text>
        </Box>
        <Box>
          <Text inverse> ^T </Text>
          <Text> Transcript  </Text>
        </Box>
        <Box>
          <Text inverse> ^C </Text>
          <Text> Exit</Text>
        </Box>
      </Box>
    </Box>
  );
}
