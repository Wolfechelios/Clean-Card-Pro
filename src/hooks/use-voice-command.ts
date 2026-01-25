import { useEffect, useState, useRef, useCallback } from "react";

interface VoiceCommandOptions {
  enabled: boolean;
  keyword: string;
  onMatch: () => void;
}

interface VoiceCommandResult {
  listening: boolean;
  supported: boolean;
}

export function useVoiceCommand(opts: VoiceCommandOptions): VoiceCommandResult {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Check for browser support
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSupported(!!SpeechRecognition);
  }, []);

  const startListening = useCallback(() => {
    if (!supported || !opts.enabled) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setListening(true);
      };

      recognition.onend = () => {
        setListening(false);
        // Auto-restart if still enabled
        if (opts.enabled && recognitionRef.current === recognition) {
          try {
            recognition.start();
          } catch {
            // ignore
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("Voice recognition error:", event.error);
        setListening(false);
      };

      recognition.onresult = (event: any) => {
        const results = event.results;
        for (let i = event.resultIndex; i < results.length; i++) {
          const transcript = results[i][0].transcript.toLowerCase().trim();
          if (transcript.includes(opts.keyword.toLowerCase())) {
            opts.onMatch();
            break;
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.warn("Failed to start voice recognition:", e);
      setListening(false);
    }
  }, [supported, opts.enabled, opts.keyword, opts.onMatch]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  useEffect(() => {
    if (opts.enabled && supported) {
      startListening();
    } else {
      stopListening();
    }

    return () => {
      stopListening();
    };
  }, [opts.enabled, supported, startListening, stopListening]);

  return {
    listening,
    supported,
  };
}
