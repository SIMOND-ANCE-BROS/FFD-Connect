export default class Sound {
  constructor(
    _path: string | null,
    _basePath: string | null,
    callback: ((error: Error | null) => void) | null,
  ) {
    if (callback) callback(null);
  }
  setVolume() {
    return this;
  }
  setPan() {
    return this;
  }
  setNumberOfLoops() {
    return this;
  }
  setSpeed() {
    return this;
  }
  setPitch() {
    return this;
  }
  setCategory() {
    return this;
  }
  play(cb: (success: boolean) => void) {
    cb(true);
    return this;
  }
  pause() {
    return this;
  }
  stop() {
    return this;
  }
  release() {
    return this;
  }
  getCurrentTime(cb: (seconds: number) => void) {
    cb(0);
  }
  getDuration() {
    return 0;
  }
  getNumberOfChannels() {
    return 0;
  }
  isLoaded() {
    return true;
  }
  static setCategory() {}
}
