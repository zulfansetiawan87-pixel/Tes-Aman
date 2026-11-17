import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViolationType } from '../types/quiz.ts';

interface UseExamSecurityOptions {
  enabled: boolean;
  requireFullscreen: boolean;
  onViolation: (type: ViolationType, detail: string) => void;
}

export function useExamSecurity({
  enabled,
  requireFullscreen,
  onViolation,
}: UseExamSecurityOptions) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const lastEventMapRef = useRef<Record<string, number>>({});
  const initialWidthRef = useRef<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );

  const emitViolation = useCallback(
    (type: ViolationType, detail: string, message: string) => {
      const now = Date.now();
      const prev = lastEventMapRef.current[type] || 0;
      if (now - prev < 1500) return;
      lastEventMapRef.current[type] = now;
      setWarningMessage(message);
      onViolation(type, detail);
    },
    [onViolation]
  );

  const requestFullscreen = useCallback(async (): Promise<boolean> => {
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        await el.requestFullscreen();
        setIsFullscreen(true);
        return true;
      }
      setIsFullscreen(Boolean(document.fullscreenElement));
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    initialWidthRef.current = window.innerWidth;
    setIsFullscreen(Boolean(document.fullscreenElement));

    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (!active && requireFullscreen) {
        emitViolation(
          'fullscreen_exit',
          'Peserta keluar dari mode layar penuh (Fullscreen API).',
          'Mode layar penuh dinonaktifkan. Silakan kembali ke layar penuh untuk melanjutkan ujian.'
        );
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        emitViolation(
          'tab_switch',
          'Tab atau aplikasi berpindah ke latar belakang (visibilitychange: hidden).',
          'Perpindahan tab atau jendela terdeteksi dan dicatat ke log pengawasan.'
        );
      }
    };

    const handleWindowBlur = () => {
      emitViolation(
        'window_blur',
        'Fokus jendela browser hilang (window blur).',
        'Jendela ujian kehilangan fokus. Tetap berada di layar ujian.'
      );
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      emitViolation(
        'context_menu',
        'Klik kanan / menu konteks diblokir.',
        'Menu konteks dinonaktifkan selama ujian berlangsung.'
      );
    };

    const handleCopyCutPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      if (e.type === 'copy' || e.type === 'cut') {
        e.preventDefault();
        emitViolation(
          'copy_attempt',
          `Percobaan ${e.type} teks soal diblokir.`,
          'Menyalin teks soal atau jawaban tidak diizinkan selama ujian.'
        );
        return;
      }

      if (e.type === 'paste' && !isEditable) {
        e.preventDefault();
        emitViolation(
          'paste_attempt',
          'Percobaan menempelkan teks (paste) diblokir.',
          'Menempelkan teks dari clipboard tidak diizinkan selama ujian.'
        );
      } else if (e.type === 'paste' && isEditable) {
        e.preventDefault();
        emitViolation(
          'paste_attempt',
          'Percobaan paste ke kolom jawaban uraian diblokir.',
          'Ketik jawaban uraian secara langsung tanpa paste dari clipboard.'
        );
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      const blockedCombo =
        e.key === 'F12' ||
        (ctrlOrMeta && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) ||
        (ctrlOrMeta && (key === 'u' || key === 'p' || key === 's'));

      if (blockedCombo) {
        e.preventDefault();
        emitViolation(
          'shortcut_blocked',
          `Pintasan keyboard terlarang (${e.key}) diblokir.`,
          'Pintasan inspeksi, cetak, atau simpan halaman dinonaktifkan selama ujian.'
        );
      }
    };

    const handleResize = () => {
      const initW = initialWidthRef.current;
      if (initW >= 768 && window.innerWidth < initW * 0.62) {
        emitViolation(
          'resize_split_warning',
          `Lebar viewport menyusut drastis (${window.innerWidth}px dari ${initW}px).`,
          'Perubahan ukuran jendela drastis terdeteksi (indikasi split-screen).'
        );
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleCopyCutPaste);
    document.addEventListener('cut', handleCopyCutPaste);
    document.addEventListener('paste', handleCopyCutPaste);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleCopyCutPaste);
      document.removeEventListener('cut', handleCopyCutPaste);
      document.removeEventListener('paste', handleCopyCutPaste);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [enabled, requireFullscreen, emitViolation]);

  return {
    isFullscreen,
    warningMessage,
    clearWarning: () => setWarningMessage(null),
    requestFullscreen,
  };
}
