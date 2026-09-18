import { describe, expect, it, vi } from 'vitest';
import { TypewriterAudio } from './audio-engine.js';

describe('TypewriterAudio channel controls', () => {
  it('adopts the context unlocked by the early entry gesture only once', async () => {
    const context = { state: 'suspended', resume: vi.fn().mockResolvedValue(undefined) };
    const createContext = vi.fn(() => context);
    const fallback = vi.fn();
    vi.stubGlobal('window', { AudioContext: fallback });
    try {
      const audio = new TypewriterAudio({ contextFactory: createContext });
      audio.connectOutputs = vi.fn();
      audio.makeNoiseBuffer = vi.fn(() => 'noise');
      await audio.start();
      context.state = 'running';
      await audio.start();
      expect(audio.context).toBe(context);
      expect(createContext).toHaveBeenCalledTimes(1);
      expect(audio.connectOutputs).toHaveBeenCalledTimes(1);
      expect(context.resume).toHaveBeenCalledTimes(1);
      expect(fallback).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps paper volume independent from the mechanical channel', () => {
    const audio = new TypewriterAudio();

    expect(audio.setVolume(0.21)).toBe(0.21);
    expect(audio.setPaperVolume(0.83)).toBe(0.83);
    expect(audio.volume).toBe(0.21);
    expect(audio.paperVolume).toBe(0.83);
  });

  it('routes paper movement to its dedicated output', () => {
    const audio = new TypewriterAudio();
    const paperOutput = { name: 'paper-output' };
    audio.paperMaster = paperOutput;
    audio.noise = vi.fn();

    audio.paper();

    expect(audio.noise).toHaveBeenCalledWith(expect.objectContaining({
      destination: paperOutput,
      type: 'highpass',
    }));
  });
});
