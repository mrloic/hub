import { registerHubAudio } from "./runtime";
import { RNNoiseProcessor } from "../../../../../packages/audio/src/dsp";
import { Rnnoise } from "./rnnoise.generated.js";
registerHubAudio(async () => {
  const module = await Rnnoise.load();
  if (module.frameSize !== 480) throw new Error("frame size");
  return new RNNoiseProcessor(module.createDenoiseState());
});
