/**
 * Type definitions for RemoteClaw
 */

export interface RemoteClawOptions {
  gatewayUrl: string;
  gatewayToken?: string;
  model?: string;
  sessionName?: string;
}

export interface Session {
  id: string;
  name: string;
  model: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
}

export interface UsageStats {
  quotaUsed?: number;
  quotaTotal?: number;
  quotaResetAt?: number;
  todaySpend?: number;
  averageDailySpend?: number;
  modelPricing?: {
    inputPer1M: number;
    outputPer1M: number;
  };
}
