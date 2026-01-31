/**
 * Tailscale Status Detection Service
 *
 * Lightweight checker that shells out to `tailscale` CLI
 * to determine installation and connection status.
 */

import { execSync } from 'child_process';

export type TailscaleStatus = 'connected' | 'not-running' | 'not-installed' | 'logged-out';

function checkInstalled(): boolean {
  try {
    execSync('which tailscale', { timeout: 3000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkRunning(): 'connected' | 'not-running' | 'logged-out' {
  try {
    const output = execSync('tailscale status', { timeout: 3000, stdio: 'pipe' }).toString();
    if (output.includes('Logged out')) {
      return 'logged-out';
    }
    return 'connected';
  } catch (err: unknown) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? '';
    if (stderr.includes('not logged in') || stderr.includes('Logged out')) {
      return 'logged-out';
    }
    return 'not-running';
  }
}

export function getStatus(): TailscaleStatus {
  if (!checkInstalled()) {
    return 'not-installed';
  }
  return checkRunning();
}
