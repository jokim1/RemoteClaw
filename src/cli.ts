#!/usr/bin/env node

/**
 * RemoteClaw CLI
 *
 * Entry point for the remoteclaw command
 */

import { Command } from 'commander';
import { loadConfig, saveConfig, resolveGatewayConfig, getConfigPath } from './config.js';
import { ChatService } from './services/chat.js';
import { launchRemoteClaw } from './tui/app.js';

const program = new Command();

program
  .name('remoteclaw')
  .description('Remote LLM chat TUI for Moltbot gateway')
  .version('0.1.0')
  .option('-g, --gateway <url>', 'Gateway URL (e.g. http://100.x.x.x:18789)')
  .option('-t, --token <token>', 'Gateway authentication token')
  .option('-m, --model <model>', 'Model to use (e.g. anthropic/claude-sonnet-4-5)')
  .option('-s, --session <name>', 'Session name to resume or create')
  .action(async (opts) => {
    const resolved = resolveGatewayConfig({
      gateway: opts.gateway,
      token: opts.token,
      model: opts.model,
    });

    // Auto-persist gateway/token to config when provided via CLI
    if (opts.gateway || opts.token) {
      const existing = loadConfig();
      if (opts.gateway) existing.gatewayUrl = opts.gateway;
      if (opts.token) existing.gatewayToken = opts.token;
      saveConfig(existing);
    }

    // Validate gateway is reachable before launching TUI
    const chatService = new ChatService({
      gatewayUrl: resolved.gatewayUrl,
      gatewayToken: resolved.gatewayToken,
      agentId: resolved.agentId || 'remoteclaw',
      model: resolved.defaultModel,
    });

    const healthy = await chatService.checkHealth();
    if (!healthy) {
      console.error(`\nCannot reach gateway at ${resolved.gatewayUrl}\n`);
      console.error('Troubleshooting:');
      console.error('  1. Is the Moltbot gateway running on the remote machine?');
      console.error('  2. Is Tailscale connected? (run: tailscale status)');
      console.error(`  3. Can you reach the gateway? (run: curl ${resolved.gatewayUrl}/health)`);
      if (!resolved.gatewayToken) {
        console.error('  4. Do you need an auth token? (run: remoteclaw config --token <token>)');
      }
      console.error(`\nConfig file: ${getConfigPath()}`);
      console.error('Set gateway:  remoteclaw config --gateway <url>');
      console.error('Set token:    remoteclaw config --token <token>\n');
      process.exit(1);
    }

    await launchRemoteClaw({
      gatewayUrl: resolved.gatewayUrl,
      gatewayToken: resolved.gatewayToken,
      model: opts.model || resolved.defaultModel,
      sessionName: opts.session,
    });
  });

// Config subcommand
const configCmd = program
  .command('config')
  .description('View or update RemoteClaw configuration')
  .option('-g, --gateway <url>', 'Set gateway URL')
  .option('-t, --token <token>', 'Set gateway auth token')
  .option('-m, --model <model>', 'Set default model')
  .option('--show', 'Show current configuration')
  .action((opts) => {
    const config = loadConfig();
    let updated = false;

    if (opts.gateway) {
      config.gatewayUrl = opts.gateway;
      updated = true;
    }

    if (opts.token) {
      config.gatewayToken = opts.token;
      updated = true;
    }

    if (opts.model) {
      config.defaultModel = opts.model;
      updated = true;
    }

    if (updated) {
      saveConfig(config);
      console.log('Configuration saved.\n');
    }

    // Always show config after update, or when --show is passed, or when no flags given
    if (updated || opts.show || (!opts.gateway && !opts.token && !opts.model)) {
      console.log(`Config file: ${getConfigPath()}\n`);
      console.log(`  Gateway URL:   ${config.gatewayUrl}`);
      console.log(`  Gateway Token: ${config.gatewayToken ? '********' : '(not set)'}`);
      console.log(`  Default Model: ${config.defaultModel || '(not set)'}`);
      console.log(`  Agent ID:      ${config.agentId || 'remoteclaw'}`);
      console.log('');
    }
  });

program.parse();
