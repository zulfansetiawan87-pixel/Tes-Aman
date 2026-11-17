import React, { useEffect, useRef, useState } from 'react';
import { Headphones, Pause, Play, Volume2 } from 'lucide-react';

interface AudioStimulusPlayerProps {
  src: string;
  playLimit?: number;
  questionId: string;
  attemptId?: string;
}

export const AudioStimulusPlayer: React.FC<AudioStimulusPlayerProps> = ({
  src,
  playLimit,
  questionId,
  attemptId,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const storageKey = attemptId ? `sq_audio_${attemptId}_${questionId}` : null;
  const [playsUsed, setPlaysUsed] = useState<number>(() => {
    if (!storageKey) return 0;
    try {
      return Number(localStorage.getItem(storageKey) || '0');
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    if (!storageKey) {
      setPlaysUsed(0);
      return;
    }
    try {
      setPlaysUsed(Number(localStorage.getItem(storageKey) || '0'));
    } catch {
      setPlaysUsed(0);
    }
  }, [storageKey]);

  const limitReached = Boolean(playLimit && playLimit > 0 && playsUsed >= playLimit && !isPlaying);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    if (limitReached) return;

    if (audio.currentTime === 0 || audio.ended) {
      const nextCount = playsUsed + 1;
      setPlaysUsed(nextCount);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, String(nextCount));
        } catch {
          // ignore storage quota
        }
      }
    }

    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  const formatTime = (sec: number) => {
    if (!Number.isFinite(sec) || sec <= 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0F2544] text-white">
            <Headphones className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate">
              Audio Stimulus (Listening Comprehension)
            </p>
            <p className="text-[11px] text-slate-500 font-mono tabular-nums">
              {formatTime(progress)} / {formatTime(duration)}
              {playLimit && playLimit > 0
                ? ` · Putar ${playsUsed}/${playLimit}`
                : ' · Putar bebas'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void togglePlay()}
          disabled={limitReached}
          className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition-colors cursor-pointer ${
            limitReached
              ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          <span>{limitReached ? 'Batas Tercapai' : isPlaying ? 'Jeda' : 'Putar'}</span>
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Volume2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-blue-600 transition-all duration-150"
            style={{ width: duration > 0 ? `${Math.min(100, (progress / duration) * 100)}%` : '0%' }}
          />
        </div>
      </div>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
      />
    </div>
  );
};
