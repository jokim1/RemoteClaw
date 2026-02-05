/**
 * RemoteClaw TUI App
 *
 * Main terminal user interface built with Ink (React for CLI).
 * Composes custom hooks for gateway, chat, voice, and model management.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { render, Box, Text, Static, useInput, useApp, useStdout } from 'ink';
import type { RemoteClawOptions, ModelStatus, Message } from '../types.js';
import { StatusBar, ShortcutBar } from './components/StatusBar';
import { InputArea } from './components/InputArea.js';
import { StaticMessage } from './components/StaticMessage.js';
import type { StaticItem, StaticItemInput } from './components/StaticMessage.js';
import { ModelPicker } from './components/ModelPicker.js';
import type { Model } from './components/ModelPicker.js';
import { TranscriptHub } from './components/TranscriptHub';
import { TalksHub } from './components/TalksHub';
import { SettingsPicker } from './components/SettingsPicker.js';
import { ChatService } from '../services/chat';
import { getSessionManager } from '../services/sessions';
import type { SessionManager } from '../services/sessions';
import { getTalkManager } from '../services/talks';
import type { TalkManager } from '../services/talks';
import type { Talk } from '../types.js';
import { spawnNewTerminalWindow } from '../services/terminal.js';
import { VoiceService } from '../services/voice.js';
import { RealtimeVoiceService } from '../services/realtime-voice.js';
import { AnthropicRateLimitService } from '../services/anthropic-ratelimit.js';
import { loadConfig, getBillingForProvider } from '../config.js';
import type { BillingOverride } from '../config.js';
import {
  getModelAlias,
  getModelPricing,
  getProviderKey,
  formatPricingLabel,
} from '../models.js';
import { DEFAULT_MODEL, RESIZE_DEBOUNCE_MS } from '../constants.js';
import { createMessage, cleanInputChar } from './helpers.js';
import { formatElapsed } from './utils.js';
import { dispatchCommand } from './commands.js';
import { useGateway } from './hooks/useGateway.js';
import { useChat } from './hooks/useChat.js';
import { useVoice } from './hooks/useVoice.js';
import { useRealtimeVoice } from './hooks/useRealtimeVoice.js';

interface AppProps {
  options: RemoteClawOptions;
}

function App({ options }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [savedConfig, setSavedConfig] = useState(() => loadConfig());

  // --- Resize handling ---

  const [dimensions, setDimensions] = useState({
    width: stdout?.columns ?? 80,
    height: stdout?.rows ?? 24,
  });
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleResize = () => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = setTimeout(() => {
        setDimensions({ width: stdout?.columns ?? 80, height: stdout?.rows ?? 24 });
      }, RESIZE_DEBOUNCE_MS);
    };
    stdout?.on('resize', handleResize);
    return () => {
      stdout?.off('resize', handleResize);
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    };
  }, [stdout]);

  const terminalHeight = dimensions.height;
  const terminalWidth = dimensions.width;

  // --- Service refs ---

  const chatServiceRef = useRef<ChatService | null>(null);
  const sessionManagerRef = useRef<SessionManager | null>(null);
  const talkManagerRef = useRef<TalkManager | null>(null);
  const voiceServiceRef = useRef<VoiceService | null>(null);
  const realtimeVoiceServiceRef = useRef<RealtimeVoiceService | null>(null);
  const anthropicRLRef = useRef<AnthropicRateLimitService | null>(null);

  // --- Shared state ---

  const [currentModel, setCurrentModel] = useState(options.model ?? DEFAULT_MODEL);
  const currentModelRef = useRef(currentModel);
  useEffect(() => { currentModelRef.current = currentModel; }, [currentModel]);

  const [modelStatus, setModelStatus] = useState<ModelStatus>('unknown');
  const probeAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showTalks, setShowTalks] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionName, setSessionName] = useState('Session 1');
  const [activeTalkId, setActiveTalkId] = useState<string | null>(null);
  const activeTalkIdRef = useRef<string | null>(null);
  useEffect(() => { activeTalkIdRef.current = activeTalkId; }, [activeTalkId]);
  const [messageQueue, setMessageQueue] = useState<string[]>([]);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);

  // --- Static items (append-only list for Ink's <Static>) ---

  const [staticItems, setStaticItems] = useState<StaticItem[]>([]);
  const nextStaticIdRef = useRef(0);
  const pushStatic = useCallback((...items: StaticItemInput[]) => {
    setStaticItems(prev => [
      ...prev,
      ...items.map(item => ({ ...item, id: String(nextStaticIdRef.current++) } as StaticItem)),
    ]);
  }, []);

  // Ref for useChat to notify when messages complete
  const onMessageCompleteRef = useRef<((msg: Message) => void) | null>(null);

  // --- TTS bridge ref (useChat → useVoice) ---

  const speakResponseRef = useRef<((text: string) => void) | null>(null);

  // --- Pricing ref (kept current for session cost calculation) ---

  const pricingRef = useRef({ inputPer1M: 0.14, outputPer1M: 0.28 });

  // --- Hooks ---

  const chat = useChat(
    chatServiceRef, sessionManagerRef, currentModelRef,
    setError, speakResponseRef,
    (err) => setModelStatus({ error: err }),
    pricingRef,
    activeTalkIdRef,
    onMessageCompleteRef,
  );

  // Wire onMessageComplete: push completed messages to Static
  onMessageCompleteRef.current = useCallback((msg: Message) => {
    pushStatic({ type: 'message', message: msg });
  }, [pushStatic]);

  // Track when processing starts/stops for timer display
  useEffect(() => {
    if (chat.isProcessing && !processingStartTime) {
      setProcessingStartTime(Date.now());
    } else if (!chat.isProcessing && processingStartTime) {
      setProcessingStartTime(null);
    }
  }, [chat.isProcessing, processingStartTime]);

  // Tick timer every second while processing (for "Waiting for Xs" display)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!processingStartTime) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [processingStartTime]);

  const gateway = useGateway(
    chatServiceRef, voiceServiceRef, realtimeVoiceServiceRef, anthropicRLRef, currentModelRef,
    {
      onInitialProbe: (model) => {
        // Skip if a probe was already triggered (e.g., by switchModel)
        if (modelStatus !== 'unknown') return;
        // Skip 'checking' state during initial probe to prevent layout shift
        probeCurrentModel(model, undefined, true);
      },
      onBillingDiscovered: (billing) => {
        setSavedConfig(prev => ({
          ...prev,
          billing: { ...billing, ...prev.billing },
        }));
      },
    },
  );

  const voice = useVoice({
    voiceServiceRef,
    readiness: gateway.voiceCaps.readiness,
    ttsAvailable: gateway.voiceCaps.ttsAvailable,
    voiceConfig: savedConfig.voice,
    sendMessageRef: chat.sendMessageRef,
    onInputText: setInputText,
    setError,
  });

  const realtimeVoice = useRealtimeVoice({
    realtimeServiceRef: realtimeVoiceServiceRef,
    capabilities: gateway.realtimeVoiceCaps,
    setError,
  });

  // Wire TTS: when chat receives an assistant response, speak it
  speakResponseRef.current = voice.speakResponse;

  // --- Service initialization ---

  useEffect(() => {
    chatServiceRef.current = new ChatService({
      gatewayUrl: options.gatewayUrl,
      gatewayToken: options.gatewayToken,
      agentId: 'remoteclaw',
      model: currentModel,
    });

    voiceServiceRef.current = new VoiceService({
      gatewayUrl: options.gatewayUrl,
      gatewayToken: options.gatewayToken,
    });

    realtimeVoiceServiceRef.current = new RealtimeVoiceService({
      gatewayUrl: options.gatewayUrl,
      gatewayToken: options.gatewayToken,
    });

    if (options.anthropicApiKey) {
      anthropicRLRef.current = new AnthropicRateLimitService(options.anthropicApiKey);
    }

    sessionManagerRef.current = getSessionManager();
    talkManagerRef.current = getTalkManager();

    let session;
    if (options.sessionName) {
      const existing = sessionManagerRef.current.listSessions().find(s => s.name === options.sessionName);
      if (existing) {
        session = sessionManagerRef.current.setActiveSession(existing.id) || sessionManagerRef.current.getActiveSession();
      } else {
        session = sessionManagerRef.current.createSession(options.sessionName, options.model);
      }
    } else {
      session = sessionManagerRef.current.createSession(undefined, options.model);
    }

    // Create a talk for this session
    const talk = talkManagerRef.current.createTalk(session.id);
    setActiveTalkId(talk.id);

    // Batch state updates by deferring to next tick (allows React to batch)
    // This prevents multiple re-renders during initialization
    const msgs = session.messages;
    const model = session.model;
    const name = session.name;

    // Use a micro-task to batch these updates
    queueMicrotask(() => {
      chat.setMessages(msgs);
      setCurrentModel(model);
      setSessionName(name);

      // Push existing session messages + welcome to Static
      const items: StaticItemInput[] = [{ type: 'welcome' as const }];
      for (const msg of msgs) {
        items.push({ type: 'message' as const, message: msg });
      }
      pushStatic(...items);
    });

    if (chatServiceRef.current && session.model) {
      chatServiceRef.current.setModel(session.model);
      chatServiceRef.current.setModelOverride(session.model).catch(() => {});
    }

    return () => {
      voiceServiceRef.current?.cleanup();
      realtimeVoiceServiceRef.current?.cleanup();
    };
  }, []);

  // --- Model management ---

  const probeCurrentModel = useCallback((modelId: string, previousModel?: string, skipCheckingState?: boolean) => {
    probeAbortRef.current?.abort();
    const controller = new AbortController();
    probeAbortRef.current = controller;

    // Skip 'checking' state during initial probe to prevent layout shift
    if (!skipCheckingState) {
      setModelStatus('checking');
    }

    chatServiceRef.current?.probeModel(modelId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setModelStatus('ok');
        const sysMsg = createMessage('system', `${getModelAlias(modelId)} is responding. Ready.`);
        chat.setMessages(prev => [...prev, sysMsg]);
        pushStatic({ type: 'message', message: sysMsg });
      } else {
        setModelStatus({ error: result.reason });
        setError(result.reason);
        const sysMsg = createMessage('system', `Model probe failed: ${result.reason}`);
        chat.setMessages(prev => [...prev, sysMsg]);
        pushStatic({ type: 'message', message: sysMsg });
        // Revert to previous model on probe failure
        if (previousModel) {
          setCurrentModel(previousModel);
          chatServiceRef.current?.setModel(previousModel);
          sessionManagerRef.current?.setSessionModel(previousModel);
        }
      }
    });
  }, []);

  // Update model pricing when model changes
  useEffect(() => {
    if (chatServiceRef.current) {
      chatServiceRef.current.setModel(currentModel);
      const p = getModelPricing(currentModel);
      pricingRef.current = { inputPer1M: p.input, outputPer1M: p.output };
      gateway.setUsage(prev => ({
        ...prev,
        modelPricing: { inputPer1M: p.input, outputPer1M: p.output },
      }));
    }
  }, [currentModel]);

  const switchModel = useCallback((modelId: string) => {
    const previousModel = chatServiceRef.current?.getModel();
    setCurrentModel(modelId);
    chatServiceRef.current?.setModel(modelId);
    sessionManagerRef.current?.setSessionModel(modelId);

    // Save model to the active talk for persistence
    if (activeTalkIdRef.current && talkManagerRef.current) {
      talkManagerRef.current.setModel(activeTalkIdRef.current, modelId);
    }

    const sysMsg = createMessage('system', `Switched to ${getModelAlias(modelId)}. Checking connection...`);
    chat.setMessages(prev => [...prev, sysMsg]);
    pushStatic({ type: 'message', message: sysMsg });
    setError(null);

    chatServiceRef.current?.setModelOverride(modelId).catch(() => {});
    probeCurrentModel(modelId, previousModel);
  }, [probeCurrentModel, pushStatic]);

  const selectModel = useCallback((modelId: string) => {
    setShowModelPicker(false);
    switchModel(modelId);
  }, [switchModel]);

  // Build picker model list
  const pickerModels: Model[] = gateway.availableModels.map(m => {
    const providerBilling = getBillingForProvider(savedConfig, getProviderKey(m.id));
    return {
      id: m.id,
      label: `${m.emoji} ${m.name}`,
      preset: m.tier,
      provider: m.provider,
      pricingLabel: formatPricingLabel(m, providerBilling),
    };
  });

  // --- Talk handlers ---

  const handleSaveTalk = useCallback((title?: string) => {
    if (activeTalkId && talkManagerRef.current) {
      const success = talkManagerRef.current.saveTalk(activeTalkId);
      if (success) {
        const text = title ? `Chat saved as "${title}"` : 'Chat saved to Talks.';
        if (title) talkManagerRef.current.setTopicTitle(activeTalkId, title);
        const sysMsg = createMessage('system', text);
        chat.setMessages(prev => [...prev, sysMsg]);
        pushStatic({ type: 'message', message: sysMsg });
      } else {
        setError('Failed to save talk');
      }
    }
  }, [activeTalkId, pushStatic]);

  const handleSetTopicTitle = useCallback((title: string) => {
    if (activeTalkId && talkManagerRef.current) {
      const success = talkManagerRef.current.setTopicTitle(activeTalkId, title);
      if (success) {
        const sysMsg = createMessage('system', `Topic set to: ${title}`);
        chat.setMessages(prev => [...prev, sysMsg]);
        pushStatic({ type: 'message', message: sysMsg });
      } else {
        setError('Failed to set topic');
      }
    }
  }, [activeTalkId, pushStatic]);

  const handleNewChat = useCallback(() => {
    // Update context MD for current talk before creating new chat
    if (activeTalkId && talkManagerRef.current) {
      talkManagerRef.current.updateContextMd(activeTalkId, chat.messages);
    }

    // Create new session
    const session = sessionManagerRef.current?.createSession(undefined, currentModel);
    if (session) {
      // Create a new talk for this session
      const talk = talkManagerRef.current?.createTalk(session.id);
      if (talk) {
        setActiveTalkId(talk.id);
      }

      chat.setMessages([]);
      setSessionName(session.name);
      const sysMsg = createMessage('system', 'New chat started.');
      chat.setMessages(prev => [...prev, sysMsg]);
      pushStatic(
        { type: 'divider', text: '─── New Chat ───' },
        { type: 'message', message: sysMsg },
      );
    }
  }, [activeTalkId, chat.messages, currentModel, pushStatic]);

  const handleSelectTalk = useCallback((talk: Talk) => {
    // Update context MD for current talk before switching
    if (activeTalkId && talkManagerRef.current) {
      talkManagerRef.current.updateContextMd(activeTalkId, chat.messages);
    }

    // Switch to the selected talk's session
    const session = sessionManagerRef.current?.setActiveSession(talk.sessionId);
    if (session) {
      chat.setMessages(session.messages);
      setSessionName(session.name);
      setActiveTalkId(talk.id);
      talkManagerRef.current?.setActiveTalk(talk.id);
      talkManagerRef.current?.touchTalk(talk.id);

      // Push divider + all messages from the switched-to talk into Static
      const talkLabel = talk.topicTitle || session.name || 'Talk';
      const items: StaticItemInput[] = [
        { type: 'divider' as const, text: `─── ${talkLabel} ───` },
      ];
      for (const msg of session.messages) {
        items.push({ type: 'message' as const, message: msg });
      }
      pushStatic(...items);

      // Restore the model from the talk if it has one
      if (talk.model) {
        switchModel(talk.model);
      }

      setShowTalks(false);
    }
  }, [activeTalkId, chat.messages, switchModel, pushStatic]);

  // --- Submit handler (command registry + chat) ---

  const commandCtx = useRef({
    switchModel,
    openModelPicker: () => setShowModelPicker(true),
    clearSession: () => {
      chat.setMessages([]);
      sessionManagerRef.current?.clearActiveSession();
      setError(null);
    },
    setError,
    saveTalk: handleSaveTalk,
    setTopicTitle: handleSetTopicTitle,
  });
  commandCtx.current = {
    switchModel,
    openModelPicker: () => setShowModelPicker(true),
    clearSession: () => { chat.setMessages([]); sessionManagerRef.current?.clearActiveSession(); setError(null); },
    setError,
    saveTalk: handleSaveTalk,
    setTopicTitle: handleSetTopicTitle,
  };

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (dispatchCommand(trimmed, commandCtx.current)) {
      setInputText('');
      return;
    }

    setInputText('');

    // If already processing, queue the message
    if (chat.isProcessing) {
      setMessageQueue(prev => [...prev, trimmed]);
      return;
    }

    await chat.sendMessage(trimmed);
  }, [chat.sendMessage, chat.isProcessing]);

  // Process queued messages when AI finishes responding
  useEffect(() => {
    if (!chat.isProcessing && messageQueue.length > 0) {
      const nextMessage = messageQueue[0];
      setMessageQueue(prev => prev.slice(1));
      chat.sendMessage(nextMessage);
    }
  }, [chat.isProcessing, messageQueue, chat.sendMessage]);

  // --- Keyboard shortcuts ---

  useInput((input, key) => {
    if (showModelPicker || showTranscript || showTalks || showSettings) return;

    if (key.escape) {
      if (voice.handleEscape()) return;
    }

    // ^X Exit
    if (input === 'x' && key.ctrl) {
      voiceServiceRef.current?.cleanup();
      exit();
      return;
    }

    // ^T Talks (open saved conversations list)
    if (input === 't' && key.ctrl) {
      setShowTalks(true);
      cleanInputChar(setInputText, 't');
      return;
    }

    // ^A AI Model (opens model picker)
    if (input === 'a' && key.ctrl) {
      setShowModelPicker(true);
      cleanInputChar(setInputText, 'a');
      return;
    }

    // ^P Push-to-Talk (voice recording)
    if (input === 'p' && key.ctrl) {
      if (chat.isProcessing) {
        setError('Cannot record while processing');
      } else {
        voice.handleVoiceToggle();
      }
      cleanInputChar(setInputText, 'p');
      return;
    }

    // ^C Chat (realtime voice)
    if (input === 'c' && key.ctrl) {
      if (chat.isProcessing) {
        setError('Cannot start chat while processing');
      } else if (realtimeVoice.isActive) {
        // End realtime session
        realtimeVoice.endSession();
      } else if (voice.voiceMode === 'liveChat') {
        // Already in legacy live chat mode - end it
        voice.handleLiveTalk?.();
      } else if (gateway.realtimeVoiceCaps?.available) {
        // Start realtime session via WebSocket
        realtimeVoice.startSession().then(success => {
          if (!success) {
            // Fall back to legacy recording mode
            voice.handleLiveTalk?.();
          }
        });
      } else {
        // No realtime available, use legacy recording mode
        voice.handleLiveTalk?.();
      }
      cleanInputChar(setInputText, 'c');
      return;
    }

    // ^H History (transcripts) - Ctrl+H sends backspace in terminals
    // Only trigger when input is empty to avoid conflict with text editing
    // Also check for literal 'h' with ctrl in case terminal sends it differently
    const isCtrlH = input === '\x08' || key.backspace || (input === '\b');
    if (isCtrlH && inputText.length === 0) {
      setShowTranscript(true);
      return;
    }

    // ^V AI Voice (toggle TTS responses)
    if (input === 'v' && key.ctrl) {
      voice.handleTtsToggle?.();
      cleanInputChar(setInputText, 'v');
      return;
    }

    // ^N New Chat (update context MD of current talk first)
    if (input === 'n' && key.ctrl) {
      handleNewChat();
      cleanInputChar(setInputText, 'n');
      return;
    }

    // ^Y New Terminal (spawn new terminal window)
    if (input === 'y' && key.ctrl) {
      spawnNewTerminalWindow(options);
      cleanInputChar(setInputText, 'y');
      return;
    }

    // ^S Settings
    if (input === 's' && key.ctrl) {
      setShowSettings(true);
      cleanInputChar(setInputText, 's');
      return;
    }

    // Generic Ctrl+key cleanup
    if (key.ctrl && input.match(/[a-z]/i)) {
      cleanInputChar(setInputText, input);
      return;
    }
  });

  // --- Layout ---

  // Cap streaming display to prevent the dynamic area from exceeding terminal height.
  // Reserve lines for: status(2) + error(1) + separator(1) + input(~2) + shortcuts(2) + margin(2)
  const maxStreamingLines = Math.max(4, terminalHeight - 10);

  // Truncate streaming content to last N lines for display
  const cappedStreaming = useMemo(() => {
    if (!chat.streamingContent) return '';
    const lines = chat.streamingContent.split('\n');
    if (lines.length <= maxStreamingLines) return chat.streamingContent;
    return lines.slice(-maxStreamingLines).join('\n');
  }, [chat.streamingContent, maxStreamingLines]);

  // Overlay max height (for model picker, talks, transcript, settings)
  const overlayMaxHeight = Math.max(6, terminalHeight - 6);

  const isOverlayActive = showModelPicker || showTranscript || showTalks || showSettings;

  // --- Render ---

  // Show loading state until gateway is initialized
  if (!gateway.isInitialized) {
    return (
      <Box flexDirection="column" width={terminalWidth}>
        <Box paddingX={1}>
          <Text dimColor>Starting RemoteClaw...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <>
      {/* Static area: completed messages scroll into terminal scrollback */}
      <Static items={staticItems}>
        {(item) => {
          if (item.type === 'divider') {
            return (
              <Box key={item.id}>
                <Text dimColor>{item.text}</Text>
              </Box>
            );
          }
          if (item.type === 'welcome') {
            return (
              <Box key={item.id} flexDirection="column">
                <Text dimColor>Welcome to RemoteClaw by Opus4.5 and Joseph Kim (@jokim1)</Text>
                <Text dimColor>Type a message to start chatting.</Text>
                <Text> </Text>
                <Text dimColor>^T Talks  ^N New  ^C Chat  ^P PTT  ^V Voice  ^H History  ^S Settings</Text>
              </Box>
            );
          }
          return <StaticMessage key={item.id} message={item.message} />;
        }}
      </Static>

      {/* Dynamic area: streaming + overlays + status + input + shortcuts */}
      <Box flexDirection="column" width={terminalWidth}>
        {/* Overlay screens (replace streaming/chat content when active) */}
        {showModelPicker ? (
          <Box paddingX={1}>
            <ModelPicker
              models={pickerModels}
              currentModel={currentModel}
              onSelect={selectModel}
              onClose={() => setShowModelPicker(false)}
              maxHeight={overlayMaxHeight}
            />
          </Box>
        ) : showTranscript ? (
          <Box paddingX={1}>
            <TranscriptHub
              currentMessages={chat.messages}
              currentSessionName={sessionName}
              sessionManager={sessionManagerRef.current!}
              maxHeight={overlayMaxHeight}
              terminalWidth={terminalWidth}
              onClose={() => setShowTranscript(false)}
              onNewChat={() => { setShowTranscript(false); handleNewChat(); }}
              onToggleTts={() => { voice.handleTtsToggle?.(); }}
              onOpenTalks={() => { setShowTranscript(false); setShowTalks(true); }}
              onOpenSettings={() => { setShowTranscript(false); setShowSettings(true); }}
              onExit={() => { voiceServiceRef.current?.cleanup(); exit(); }}
              setError={setError}
            />
          </Box>
        ) : showTalks ? (
          <Box paddingX={1}>
            <TalksHub
              talkManager={talkManagerRef.current!}
              sessionManager={sessionManagerRef.current!}
              maxHeight={overlayMaxHeight}
              terminalWidth={terminalWidth}
              onClose={() => setShowTalks(false)}
              onSelectTalk={handleSelectTalk}
              onNewChat={() => { setShowTalks(false); handleNewChat(); }}
              onToggleTts={() => { voice.handleTtsToggle?.(); }}
              onOpenHistory={() => { setShowTalks(false); setShowTranscript(true); }}
              onOpenSettings={() => { setShowTalks(false); setShowSettings(true); }}
              onOpenModelPicker={() => { setShowTalks(false); setShowModelPicker(true); }}
              onNewTerminal={() => { spawnNewTerminalWindow(options); }}
              onExit={() => { voiceServiceRef.current?.cleanup(); exit(); }}
              setError={setError}
            />
          </Box>
        ) : showSettings ? (
          <Box paddingX={1}>
            <SettingsPicker
              onClose={() => setShowSettings(false)}
              onNewChat={() => { setShowSettings(false); handleNewChat(); }}
              onToggleTts={() => { voice.handleTtsToggle?.(); }}
              onOpenTalks={() => { setShowSettings(false); setShowTalks(true); }}
              onOpenHistory={() => { setShowSettings(false); setShowTranscript(true); }}
              onExit={() => { voiceServiceRef.current?.cleanup(); realtimeVoiceServiceRef.current?.cleanup(); exit(); }}
              setError={setError}
              voiceCaps={{
                sttProviders: gateway.voiceCaps.sttProviders ?? [],
                sttActiveProvider: gateway.voiceCaps.sttProvider,
                ttsProviders: gateway.voiceCaps.ttsProviders ?? [],
                ttsActiveProvider: gateway.voiceCaps.ttsProvider,
              }}
              onSttProviderChange={async (provider) => {
                const success = await voiceServiceRef.current?.setSttProvider(provider);
                if (success) {
                  voiceServiceRef.current?.fetchCapabilities();
                }
                return success ?? false;
              }}
              onTtsProviderChange={async (provider) => {
                const success = await voiceServiceRef.current?.setTtsProvider(provider);
                if (success) {
                  voiceServiceRef.current?.fetchCapabilities();
                }
                return success ?? false;
              }}
              realtimeVoiceCaps={gateway.realtimeVoiceCaps}
              realtimeProvider={realtimeVoice.provider}
              onRealtimeProviderChange={realtimeVoice.setProvider}
            />
          </Box>
        ) : (
          <>
            {/* Streaming response (only while processing) */}
            {chat.isProcessing && (
              <Box flexDirection="column" paddingX={1}>
                <Text color="cyan" bold>{getModelAlias(currentModel)}:</Text>
                <Box paddingLeft={2}>
                  {cappedStreaming ? (
                    <Text wrap="wrap">{cappedStreaming}<Text color="cyan">▌</Text></Text>
                  ) : (
                    <Text color="gray">thinking...</Text>
                  )}
                </Box>
              </Box>
            )}

            {/* Processing timer */}
            {processingStartTime && (
              <Box paddingX={1}>
                <Text dimColor>* Waiting for {formatElapsed(processingStartTime)}</Text>
              </Box>
            )}
          </>
        )}

        {/* Error line */}
        {error && (
          <Box paddingX={1}>
            <Text color="red">! {error}</Text>
          </Box>
        )}

        {/* Status bar */}
        <StatusBar
          gatewayStatus={gateway.gatewayStatus}
          tailscaleStatus={gateway.tailscaleStatus}
          model={currentModel}
          modelStatus={modelStatus}
          usage={{ ...gateway.usage, sessionCost: chat.sessionCost }}
          billing={getBillingForProvider(savedConfig, getProviderKey(currentModel))}
          sessionName={sessionName}
          terminalWidth={terminalWidth}
          voiceMode={voice.voiceMode}
          voiceReadiness={gateway.voiceCaps.readiness}
          ttsEnabled={voice.ttsEnabled}
        />

        {/* Separator */}
        <Text dimColor>{'─'.repeat(terminalWidth)}</Text>

        {/* Queued messages */}
        {messageQueue.length > 0 && (
          <Box flexDirection="column" paddingX={1}>
            {messageQueue.map((msg, idx) => (
              <Box key={idx}>
                <Text dimColor>queued: </Text>
                <Text color="gray">{msg.length > 60 ? msg.slice(0, 60) + '...' : msg}</Text>
              </Box>
            ))}
          </Box>
        )}

        {/* Input area */}
        <Box paddingX={1}>
          <InputArea
            value={inputText}
            onChange={setInputText}
            onSubmit={handleSubmit}
            disabled={chat.isProcessing}
            voiceMode={realtimeVoice.isActive ? 'liveChat' : voice.voiceMode}
            volumeLevel={realtimeVoice.isActive ? realtimeVoice.volumeLevel : voice.volumeLevel}
            width={terminalWidth - 2}
            isActive={!isOverlayActive}
            realtimeState={realtimeVoice.state}
            userTranscript={realtimeVoice.userTranscript}
            aiTranscript={realtimeVoice.aiTranscript}
          />
        </Box>

        {/* Shortcut bar */}
        <ShortcutBar terminalWidth={terminalWidth} ttsEnabled={voice.ttsEnabled} />
      </Box>
    </>
  );
}

export async function launchRemoteClaw(options: RemoteClawOptions): Promise<void> {
  // Render into the normal terminal buffer (not alternate screen).
  // Completed messages scroll into native terminal scrollback via <Static>.
  const { waitUntilExit } = render(<App options={options} />, { exitOnCtrlC: false });

  try {
    await waitUntilExit();
  } finally {
    // Restore terminal state
    process.stdout.write('\x1b[?25h'); // Show cursor
  }
}
