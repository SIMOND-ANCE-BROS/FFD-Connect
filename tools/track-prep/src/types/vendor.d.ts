// Déclarations minimales pour les paquets audio sans types publiés.
// Le backend utilise les mêmes paquets avec des interfaces locales
// (apps/backend/src/tracks/bpm.service.ts).

declare module 'music-tempo' {
  class MusicTempo {
    constructor(data: Float32Array | number[]);
    tempo: string;
  }
  export = MusicTempo;
}

declare module 'wav-decoder' {
  export function decode(
    buffer: Buffer | ArrayBuffer,
  ): Promise<{ sampleRate: number; channelData: Float32Array[] }>;
}

declare module 'fluent-ffmpeg' {
  interface FfmpegCommand {
    input(source: string): FfmpegCommand;
    setStartTime(time: number): FfmpegCommand;
    setDuration(duration: number): FfmpegCommand;
    toFormat(format: string): FfmpegCommand;
    outputOptions(options: string[]): FfmpegCommand;
    save(output: string): FfmpegCommand;
    on(event: 'end', callback: () => void): FfmpegCommand;
    on(event: 'error', callback: (err: Error) => void): FfmpegCommand;
  }
  interface FfmpegStatic {
    (input: string): FfmpegCommand;
    setFfmpegPath(path: string): void;
  }
  const ffmpeg: FfmpegStatic;
  export = ffmpeg;
}
