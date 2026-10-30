// Optional, user-controlled sound layer. No audio context is created until a
// player interaction, so browsers never need to autoplay or request permission.
function defaultContextFactory() {
  const AudioContext = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
  return AudioContext ? new AudioContext() : null;
}

export function createGameAudio({ contextFactory = defaultContextFactory, random = Math.random } = {}) {
  let context = null;
  let enabled = false;
  let ambience = null;
  let ambienceBuffer = null;

  function stopAmbience() {
    if (!ambience) return;
    [...ambience.nodes, ...ambience.disconnect].forEach((node) => {
      try { node.stop?.(); } catch {}
      try { node.disconnect?.(); } catch {}
    });
    ambience = null;
  }

  function startAmbience(audioContext) {
    if (ambience || typeof audioContext.createBuffer !== "function") return;
    try {
      if (!ambienceBuffer) {
        const sampleRate = audioContext.sampleRate || 44100;
        ambienceBuffer = audioContext.createBuffer(1, sampleRate * 4, sampleRate);
        const samples = ambienceBuffer.getChannelData(0);
        for (let i = 0; i < samples.length; i += 1) samples[i] = (random() * 2 - 1) * 0.32;
      }

      const source = audioContext.createBufferSource();
      const filter = audioContext.createBiquadFilter();
      const level = audioContext.createGain();
      const swell = audioContext.createOscillator();
      const swellDepth = audioContext.createGain();
      source.buffer = ambienceBuffer;
      source.loop = true;
      filter.type = "lowpass";
      filter.frequency.value = 760;
      filter.Q.value = 0.45;
      level.gain.value = 0.012;
      swell.frequency.value = 0.075;
      swellDepth.gain.value = 190;
      source.connect(filter);
      filter.connect(level);
      level.connect(audioContext.destination);
      swell.connect(swellDepth);
      swellDepth.connect(filter.frequency);
      source.start();
      swell.start();
      ambience = { nodes: [source, swell], disconnect: [filter, level, swellDepth] };
    } catch {
      stopAmbience();
    }
  }

  function getContext() {
    if (!enabled) return null;
    try {
      context = context || contextFactory();
      if (!context) return null;
      if (context.state === "suspended") context.resume()?.catch?.(() => {});
      startAmbience(context);
      return context;
    } catch {
      return null;
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) stopAmbience();
    return enabled;
  }

  function playTone(kind = "tap") {
    const audioContext = getContext();
    if (!audioContext) return false;
    try {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      const frequency = kind === "success" ? 660 : (kind === "open" ? 520 : 390);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.35, now + 0.09);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.035, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.onended = () => {
        try { oscillator.disconnect(); } catch {}
        try { gain.disconnect(); } catch {}
      };
      oscillator.start(now);
      oscillator.stop(now + 0.17);
      return true;
    } catch {
      return false;
    }
  }

  function suspend() {
    if (!context || context.state !== "running" || typeof context.suspend !== "function") return;
    try { context.suspend()?.catch?.(() => {}); } catch {}
  }

  return {
    setEnabled,
    playTone,
    suspend,
    isEnabled: () => enabled
  };
}
