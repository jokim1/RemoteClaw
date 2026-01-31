/**
 * Chat Service
 *
 * Handles communication with remote Moltbot gateway for LLM chat
 */

import type { Message } from '../types.js';

export interface ChatServiceConfig {
  gatewayUrl: string;
  gatewayToken?: string;
  agentId: string;
  model?: string;
}

export interface ChatResponse {
  content: string;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class ChatService {
  private config: ChatServiceConfig;
  private sessionKey: string;

  constructor(config: ChatServiceConfig) {
    this.config = config;
    this.sessionKey = `remoteclaw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async sendMessage(
    userMessage: string,
    history: Message[] = []
  ): Promise<ChatResponse> {
    const messages = [
      ...history.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      { role: 'user' as const, content: userMessage },
    ];

    const response = await fetch(`${this.config.gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.gatewayToken && {
          'Authorization': `Bearer ${this.config.gatewayToken}`,
        }),
        'x-moltbot-agent-id': this.config.agentId,
        'x-moltbot-session-key': this.sessionKey,
      },
      body: JSON.stringify({
        model: this.config.model ?? 'moltbot',
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gateway error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    return {
      content: data.choices?.[0]?.message?.content ?? '',
      model: data.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? 0,
      } : undefined,
    };
  }

  async *streamMessage(
    userMessage: string,
    history: Message[] = []
  ): AsyncGenerator<string, void, unknown> {
    const messages = [
      ...history.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      { role: 'user' as const, content: userMessage },
    ];

    const response = await fetch(`${this.config.gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.gatewayToken && {
          'Authorization': `Bearer ${this.config.gatewayToken}`,
        }),
        'x-moltbot-agent-id': this.config.agentId,
        'x-moltbot-session-key': this.sessionKey,
      },
      body: JSON.stringify({
        model: this.config.model ?? 'moltbot',
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gateway error (${response.status}): ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.gatewayUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[] | null> {
    try {
      const response = await fetch(`${this.config.gatewayUrl}/v1/models`, {
        method: 'GET',
        headers: {
          ...(this.config.gatewayToken && {
            'Authorization': `Bearer ${this.config.gatewayToken}`,
          }),
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return null;

      const data = await response.json() as {
        data?: Array<{ id: string }>;
      };

      return data.data?.map(m => m.id) ?? null;
    } catch {
      return null;
    }
  }

  setModel(model: string): void {
    this.config.model = model;
  }

  async setModelOverride(model: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.gatewayUrl}/tools/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.gatewayToken && {
            'Authorization': `Bearer ${this.config.gatewayToken}`,
          }),
        },
        body: JSON.stringify({
          tool: 'session_status',
          args: {
            model: model === 'default' ? 'default' : model,
            sessionKey: this.sessionKey,
          },
          sessionKey: this.sessionKey,
        }),
      });

      if (!response.ok) return false;
      const result = await response.json() as { ok?: boolean };
      return result.ok === true;
    } catch {
      return false;
    }
  }

  async getCostUsage(days: number = 1): Promise<CostUsageResult | null> {
    try {
      const response = await fetch(`${this.config.gatewayUrl}/api/cost-usage?days=${days}`, {
        method: 'GET',
        headers: {
          ...(this.config.gatewayToken && {
            'Authorization': `Bearer ${this.config.gatewayToken}`,
          }),
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return null;
      return await response.json() as CostUsageResult;
    } catch {
      return null;
    }
  }
}

export interface CostUsageResult {
  totals?: {
    totalCost?: number;
    inputCost?: number;
    outputCost?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  byDay?: Array<{
    date: string;
    totalCost: number;
  }>;
}
