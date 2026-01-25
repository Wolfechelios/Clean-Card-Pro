import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = typeof window extends any
  ? (any)
  : any;

type Options = {
  enabled: boolean;
  keyword: string;
  onMatch: () => void;
};

/**
 * Lightweight voice command listener (Web Speech API).
 * Falls back silently when not supported.
 */
export function useVoiceCommand({ enabled, keyword, onMatch }: Options) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recogRef = useRef<any>(null);
  const keywordRef = useRef(keyword);
  const onMatchRef = useRef(onMatch);

  useEffect(() => {
    keywordRef.current = keyword;
  }, [keyword]);

  useEffect(() => {
    onMatchRef.current = onMatch;
  }, [onMatch]);

  useEffect(() => {
    const AnySpeech: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSupported(Boolean(AnySpeech));
  }, []);

  const stop = useCallback(() => {
    try {
      recogRef.current?.stop?.();
    } catch {
      // ignore
    }
    recogRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const AnySpeech: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!AnySpeech) return;

    const r: SpeechRecognitionLike = new AnySpeech();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";

    r.onresult = (event: any) => {
      try {
        const last = event.results?.[event.results.length - 1];
        const transcript = (last?.[0]?.transcript || "").toString().trim().toLowerCase();
        const key = (keywordRef.current || "snap").toLowerCase();
        if (transcript.includes(key)) {
          onMatchRef.current?.();
        }
      } catch {
        // ignore
      }
    };

    r.onerror = () => {
      // Some browsers throw "not-allowed" if mic permission denied.
      stop();
    };

    r.onend = () => {
      // Auto-restart when enabled.
      if (enabled) {
        try {
          r.start();
        } catch {
          stop();
        }
      } else {
        stop();
      }
    };

    recogRef.current = r;

    try {
      r.start();
      setListening(true);
    } catch {
      stop();
    }
  }, [enabled, stop]);

  useEffect(() => {
    if (!supported) return;
    if (enabled) start();
    else stop();
    return () => stop();
  }, [enabled, start, stop, supported]);

  return { supported, listening, start, stop };
}
