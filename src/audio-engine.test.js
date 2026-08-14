import { describe, expect, it, vi } from 'vitest';
import { TypewriterAudio } from './audio-engine.js';

describe('TypewriterAudio channel controls', () => {
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
