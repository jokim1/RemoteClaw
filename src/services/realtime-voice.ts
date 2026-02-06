/**
 * Realtime Voice Service
 *
 * WebSocket-based real-time voice streaming for bidirectional voice chat.
 * Connects to gateway's realtime voice endpoint which proxies to providers
 * like OpenAI Realtime API, ElevenLabs Conversational AI, etc.
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import WebSocket from 'ws';
import type {
  RealtimeVoiceProvider,
  RealtimeVoiceCapabilities,
  RealtimeClientMessage,
  RealtimeServerMessage,
  RealtimeVoiceState,
} from '../types.js';

export interface RealtimeVoiceServiceConfig {
  gatewayUrl: string;
  gatewayToken?: string;
}

export interface RealtimeSessionConfig {
  provider: RealtimeVoiceProvider;
  voice?: string;
  systemPrompt?: string;
}

export interface RealtimeVoiceCallbacks {
  onStateChange?: (state: RealtimeVoiceState) => void;
  onUserTranscript?: (text: string, isFinal: boolean) => void;
  onAITranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onSessionEnd?: (reason?: string) => void;
  onVolumeLevel?: (level: number) => void;
}

// Audio format for realtime streaming (matches OpenAI Realtime API requirements)
const SAMPLE_RATE = 24000;  // 24kHz
const CHANNELS = 1;         // Mono
const BIT_DEPTH = 16;       // 16-bit

// Keepalive interval (30 seconds)
const KEEPALIVE_INTERVAL_MS = 30000;

export class RealtimeVoiceService {
  private config: RealtimeVoiceServiceConfig;
  private ws: WebSocket | null = null;
  private recProcess: ChildProcess | null = null;
  private playProcess: ChildProcess | null = null;
  private playbackQueue: Buffer[] = [];
  private playbackInterval: NodeJS.Timeout | null = null;
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private state: RealtimeVoiceState = 'disconnected';
  private callbacks: RealtimeVoiceCallbacks = {};
  private _volumeLevel: number = 0;
  private _lastError: string | null = null;

  constructor(config: RealtimeVoiceServiceConfig) {
    this.config = config;
  }

  /** Fetch realtime voice capabilities from gateway. */
  async fetchCapabilities(): Promise<RealtimeVoiceCapabilities | null> {
    try {
      const headers: Record<string, string> = {};
      if (this.config.gatewayToken) {
        headers['Authorization'] = `Bearer ${this.config.gatewayToken}`;
      }

      const response = await fetch(`${this.config.gatewayUrl}/api/realtime-voice/capabilities`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return { available: false, providers: [] };
      }

      const data = await response.json() as {
        providers?: RealtimeVoiceProvider[];
        defaultProvider?: RealtimeVoiceProvider;
        voices?: Record<RealtimeVoiceProvider, string[]>;
      };
      return {
        available: true,
        providers: data.providers || [],
        defaultProvider: data.defaultProvider,
        voices: data.voices,
      };
    } catch {
      return null;
    }
  }

  /** Set callbacks for realtime events. */
  setCallbacks(callbacks: RealtimeVoiceCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Get current connection state. */
  getState(): RealtimeVoiceState {
    return this.state;
  }

  private setState(state: RealtimeVoiceState): void {
    this.state = state;
    this.callbacks.onStateChange?.(state);
  }

  /** Get current microphone volume level (0-100). */
  getVolumeLevel(): number {
    return this._volumeLevel;
  }

  /** Get the last error that caused a disconnect (if any). */
  getLastError(): string | null {
    return this._lastError;
  }

  /** Compute RMS volume level (0-100) from PCM16 audio buffer. */
  private computeVolumeLevel(buffer: Buffer): number {
    const sampleCount = Math.floor(buffer.length / 2);
    if (sampleCount < 10) return 0;

    let sumSquares = 0;
    for (let i = 0; i < sampleCount; i++) {
      const sample = buffer.readInt16LE(i * 2);
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / sampleCount);
    if (rms < 1) return 0;

    // Map dBFS (-50 to 0) to 0-100
    const dBFS = 20 * Math.log10(rms / 32768);
    return Math.min(100, Math.max(0, Math.round((dBFS + 50) * 2)));
  }

  /** Connect to gateway's realtime voice WebSocket endpoint. */
  async connect(sessionConfig: RealtimeSessionConfig): Promise<boolean> {
    if (this.ws) {
      this.disconnect();
    }

    this._lastError = null;
    this.setState('connecting');

    // Build WebSocket URL
    const wsProtocol = this.config.gatewayUrl.startsWith('https') ? 'wss' : 'ws';
    const baseUrl = this.config.gatewayUrl.replace(/^https?/, wsProtocol);
    const wsUrl = `${baseUrl}/api/realtime-voice/stream?provider=${sessionConfig.provider}`;

    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = (value: boolean) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      try {
        const headers: Record<string, string> = {};
        if (this.config.gatewayToken) {
          headers['Authorization'] = `Bearer ${this.config.gatewayToken}`;
        }

        this.ws = new WebSocket(wsUrl, { headers });

        this.ws.on('open', () => {
          // Cancel connection timeout
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }

          // Send initial config
          this.send({
            type: 'config',
            voice: sessionConfig.voice,
            systemPrompt: sessionConfig.systemPrompt,
          });
          this.setState('listening');

          // Start keepalive pings
          this.keepaliveInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.ping();
            }
          }, KEEPALIVE_INTERVAL_MS);

          safeResolve(true);
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error: Error) => {
          const msg = error.message || 'WebSocket error';
          this._lastError = msg;
          this.callbacks.onError?.(msg);
          this.setState('disconnected');
          safeResolve(false);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          const reasonStr = reason?.toString() || '';
          console.debug(`RealtimeVoice: WebSocket closed (code=${code}, reason=${reasonStr})`);

          this.stopStreaming();
          this.stopKeepalive();

          // Only report unexpected closes (not clean user-initiated ones)
          if (code !== 1000 && !this._lastError) {
            this._lastError = `Connection closed (code=${code}${reasonStr ? `, ${reasonStr}` : ''})`;
          }

          this.setState('disconnected');
          this.callbacks.onSessionEnd?.(this._lastError || undefined);
        });

        // Connection timeout — cancel if connection succeeds
        this.connectionTimeout = setTimeout(() => {
          this.connectionTimeout = null;
          if (this.state === 'connecting') {
            this._lastError = 'Connection timeout';
            this.disconnect();
            this.callbacks.onError?.('Connection timeout');
            safeResolve(false);
          }
        }, 10000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to connect';
        this._lastError = msg;
        this.callbacks.onError?.(msg);
        this.setState('disconnected');
        safeResolve(false);
      }
    });
  }

  /** Disconnect and cleanup. */
  disconnect(): void {
    this.stopStreaming();
    this.stopPlayback();
    this.stopKeepalive();

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    if (this.ws) {
      this.send({ type: 'end' });
      this.ws.close();
      this.ws = null;
    }

    this.setState('disconnected');
  }

  /** Start streaming audio from microphone. */
  startStreaming(): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks.onError?.('Not connected');
      return false;
    }

    if (this.recProcess) {
      return true; // Already streaming
    }

    // Stream raw PCM audio directly to WebSocket
    // Using SoX 'rec' to capture at 24kHz 16-bit mono
    this.recProcess = spawn('rec', [
      '-q',                      // Quiet (no progress)
      '-r', String(SAMPLE_RATE), // 24kHz
      '-c', String(CHANNELS),    // Mono
      '-b', String(BIT_DEPTH),   // 16-bit
      '-t', 'raw',               // Raw PCM output
      '-',                       // Output to stdout
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.recProcess.stdout?.on('data', (chunk: Buffer) => {
      // Compute volume level from incoming audio
      this._volumeLevel = this.computeVolumeLevel(chunk);
      this.callbacks.onVolumeLevel?.(this._volumeLevel);

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({
          type: 'audio',
          data: chunk.toString('base64'),
        });
      }
    });

    this.recProcess.on('error', (err) => {
      this.callbacks.onError?.(`Mic error: ${err.message}`);
      this.recProcess = null;
    });

    this.recProcess.on('close', (code) => {
      this.recProcess = null;
      // Unexpected exit — notify if session is still active
      if (code !== null && code !== 0 && this.state !== 'disconnected') {
        this.callbacks.onError?.(`Mic process exited (code=${code})`);
      }
    });

    return true;
  }

  /** Stop streaming audio from microphone. */
  stopStreaming(): void {
    if (this.recProcess) {
      this.recProcess.kill('SIGTERM');
      this.recProcess = null;
    }
  }

  /** Stop keepalive interval. */
  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  /** Interrupt the AI response (barge-in). */
  interrupt(): void {
    this.send({ type: 'interrupt' });
    this.stopPlayback();
    this.setState('listening');
  }

  /** Send a message to the gateway. */
  private send(message: RealtimeClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /** Handle incoming message from gateway. */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as RealtimeServerMessage;

      switch (message.type) {
        case 'audio':
          this.handleAudioChunk(message.data);
          break;

        case 'transcript.user':
          this.callbacks.onUserTranscript?.(message.text, message.isFinal);
          break;

        case 'transcript.ai':
          this.callbacks.onAITranscript?.(message.text, message.isFinal);
          if (!message.isFinal) {
            this.setState('aiSpeaking');
          }
          break;

        case 'error':
          this._lastError = message.message || 'Unknown error';
          this.callbacks.onError?.(message.message);
          break;

        case 'session.start':
          this.setState('listening');
          break;

        case 'session.end':
          this.callbacks.onSessionEnd?.(this._lastError || undefined);
          this.disconnect();
          break;
      }
    } catch {
      // Invalid message format, ignore
    }
  }

  /** Handle incoming audio chunk. */
  private handleAudioChunk(base64Audio: string): void {
    const audioBuffer = Buffer.from(base64Audio, 'base64');
    this.playbackQueue.push(audioBuffer);

    if (!this.playProcess) {
      this.startPlayback();
    }
  }

  /** Start audio playback from queue. */
  private startPlayback(): void {
    // Play raw PCM from stdin using SoX 'play'
    this.playProcess = spawn('play', [
      '-q',                      // Quiet
      '-r', String(SAMPLE_RATE), // 24kHz
      '-c', String(CHANNELS),    // Mono
      '-b', String(BIT_DEPTH),   // 16-bit
      '-t', 'raw',               // Raw PCM input
      '-',                       // Input from stdin
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.playProcess.on('error', (err) => {
      this.callbacks.onError?.(`Playback error: ${err.message}`);
      this.playProcess = null;
    });

    this.playProcess.on('close', () => {
      this.playProcess = null;
      if (this.state === 'aiSpeaking') {
        this.setState('listening');
      }
    });

    // Continuously write queued chunks
    this.playbackInterval = setInterval(() => {
      while (this.playbackQueue.length > 0 && this.playProcess?.stdin?.writable) {
        const chunk = this.playbackQueue.shift()!;
        this.playProcess.stdin.write(chunk);
      }
    }, 50);
  }

  /** Stop audio playback. */
  private stopPlayback(): void {
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }

    if (this.playProcess) {
      this.playProcess.stdin?.end();
      this.playProcess.kill('SIGTERM');
      this.playProcess = null;
    }

    this.playbackQueue = [];
  }

  /** Cleanup resources. */
  cleanup(): void {
    this.disconnect();
  }
}
