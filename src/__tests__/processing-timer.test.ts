/**
 * Unit tests for the waiting/processing timer logic.
 *
 * Tests cover:
 *   - formatElapsed: pure time-formatting function
 *   - nextProcessingTimerState: state machine for start/stop tracking
 *   - Timer tick behaviour (setInterval start/stop via fake timers)
 */

import { formatElapsed, nextProcessingTimerState } from '../tui/utils';

// ---------------------------------------------------------------------------
// formatElapsed
// ---------------------------------------------------------------------------

describe('formatElapsed', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns "0s" when called immediately', () => {
    const now = Date.now();
    expect(formatElapsed(now)).toBe('0s');
  });

  it('returns seconds only for < 60s', () => {
    const start = Date.now();
    jest.advanceTimersByTime(15_000);
    expect(formatElapsed(start)).toBe('15s');
  });

  it('returns "59s" just before the minute boundary', () => {
    const start = Date.now();
    jest.advanceTimersByTime(59_999);
    expect(formatElapsed(start)).toBe('59s');
  });

  it('returns "1m 0s" at exactly 60 seconds', () => {
    const start = Date.now();
    jest.advanceTimersByTime(60_000);
    expect(formatElapsed(start)).toBe('1m 0s');
  });

  it('returns "1m 30s" at 90 seconds', () => {
    const start = Date.now();
    jest.advanceTimersByTime(90_000);
    expect(formatElapsed(start)).toBe('1m 30s');
  });

  it('handles multi-minute durations', () => {
    const start = Date.now();
    jest.advanceTimersByTime(5 * 60_000 + 45_000); // 5m 45s
    expect(formatElapsed(start)).toBe('5m 45s');
  });

  it('handles large durations (> 1 hour)', () => {
    const start = Date.now();
    jest.advanceTimersByTime(90 * 60_000); // 90 minutes
    expect(formatElapsed(start)).toBe('90m 0s');
  });

  it('floors fractional seconds', () => {
    const start = Date.now();
    jest.advanceTimersByTime(7_800); // 7.8 seconds → 7s
    expect(formatElapsed(start)).toBe('7s');
  });
});

// ---------------------------------------------------------------------------
// nextProcessingTimerState
// ---------------------------------------------------------------------------

describe('nextProcessingTimerState', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sets start time when processing begins and no timer exists', () => {
    const result = nextProcessingTimerState(true, null);
    expect(result).toBeGreaterThan(0);
    expect(typeof result).toBe('number');
  });

  it('returns a timestamp close to Date.now()', () => {
    const before = Date.now();
    const result = nextProcessingTimerState(true, null);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('clears start time when processing stops', () => {
    const result = nextProcessingTimerState(false, 1000);
    expect(result).toBeNull();
  });

  it('preserves start time while still processing', () => {
    const existing = 1234567890;
    const result = nextProcessingTimerState(true, existing);
    expect(result).toBe(existing);
  });

  it('stays null when idle and no timer exists', () => {
    const result = nextProcessingTimerState(false, null);
    expect(result).toBeNull();
  });

  // Full lifecycle: idle → processing → done
  it('handles full lifecycle: idle → processing → done', () => {
    // Idle
    let state = nextProcessingTimerState(false, null);
    expect(state).toBeNull();

    // Start processing
    state = nextProcessingTimerState(true, state);
    expect(state).toBeGreaterThan(0);
    const startTime = state!;

    // Still processing — should keep the same start time
    state = nextProcessingTimerState(true, state);
    expect(state).toBe(startTime);

    // Done processing
    state = nextProcessingTimerState(false, state);
    expect(state).toBeNull();
  });

  // Rapid toggling
  it('handles rapid start/stop cycling', () => {
    let state: number | null = null;

    for (let i = 0; i < 10; i++) {
      state = nextProcessingTimerState(true, state);
      expect(state).not.toBeNull();
      state = nextProcessingTimerState(false, state);
      expect(state).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Timer tick simulation (setInterval behaviour)
// ---------------------------------------------------------------------------

describe('timer tick behaviour', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('tick callback fires every 1 second', () => {
    const tickFn = jest.fn();
    const interval = setInterval(tickFn, 1000);

    jest.advanceTimersByTime(3_500);
    expect(tickFn).toHaveBeenCalledTimes(3);

    clearInterval(interval);
  });

  it('clearInterval stops further ticks', () => {
    const tickFn = jest.fn();
    const interval = setInterval(tickFn, 1000);

    jest.advanceTimersByTime(2_000);
    expect(tickFn).toHaveBeenCalledTimes(2);

    clearInterval(interval);

    jest.advanceTimersByTime(5_000);
    expect(tickFn).toHaveBeenCalledTimes(2); // no more calls
  });

  it('interval does not fire when not started', () => {
    const tickFn = jest.fn();
    jest.advanceTimersByTime(10_000);
    expect(tickFn).not.toHaveBeenCalled();
  });

  it('simulates the full display update cycle', () => {
    // Simulate what InputArea does:
    // 1. processingStartTime is set → interval starts
    // 2. interval ticks cause re-render → formatElapsed called each tick
    // 3. processingStartTime cleared → interval stops

    const startTime = Date.now();
    const displays: string[] = [];

    // Start the interval (like useEffect does)
    const interval = setInterval(() => {
      displays.push(formatElapsed(startTime));
    }, 1000);

    // Advance 5 seconds
    jest.advanceTimersByTime(5_000);
    expect(displays).toEqual(['1s', '2s', '3s', '4s', '5s']);

    // Clear (processing done)
    clearInterval(interval);

    // No more updates
    jest.advanceTimersByTime(3_000);
    expect(displays).toHaveLength(5);
  });

  it('displays correct values across the minute boundary', () => {
    const startTime = Date.now();
    const displays: string[] = [];

    const interval = setInterval(() => {
      displays.push(formatElapsed(startTime));
    }, 1000);

    // Jump to 58 seconds in
    jest.advanceTimersByTime(58_000);
    // Jump 4 more seconds (58, 59, 60, 61)
    jest.advanceTimersByTime(4_000);

    clearInterval(interval);

    // Check the boundary values (indices 57-61 → 58s, 59s, 1m 0s, 1m 1s)
    expect(displays[57]).toBe('58s');
    expect(displays[58]).toBe('59s');
    expect(displays[59]).toBe('1m 0s');
    expect(displays[60]).toBe('1m 1s');
  });
});
