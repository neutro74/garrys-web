// Voice chat capture. The game asks for the microphone when the player talks (+voicerecord, steam.mjs StartVoiceRecording);
// the first time, the browser asks the player's permission. Audio goes to the guest through a ring (voice-worklet.js);
// playback of other players' voices uses the game's own audio output.
export class GameVoice {
  constructor(ring) { this.ring = ring; this.node = null; this.starting = null; this.denied = false; }
  async start() {
    if (this.denied) return;
    if (this.node) { this.node.port.postMessage({ on: true }); await this.context.resume(); return; }
    this.starting ??= (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        const context = new AudioContext({ latencyHint: 'interactive' });
        await context.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url));
        const node = new AudioWorkletNode(context, 'gmod-mic', { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { ring: this.ring } });
        context.createMediaStreamSource(stream).connect(node);
        this.context = context; this.stream = stream; this.node = node;
        await context.resume();
        console.log('[voice] microphone on', context.sampleRate);
      } catch (e) { this.denied = true; console.warn('[voice] no microphone:', e.message); }
      finally { this.starting = null; }
    })();
    return this.starting;
  }
  stop() { this.node?.port.postMessage({ on: false }); }
}
