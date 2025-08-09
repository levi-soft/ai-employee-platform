
import { useState } from 'react';

export interface UseClipboardReturn {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
  reset: () => void;
}

export function useClipboard(timeout = 2000): UseClipboardReturn {
  const [copied, setCopied] = useState(false);

  const copy = async (text: string): Promise<boolean> => {
    if (!navigator?.clipboard) {
      console.warn('Clipboard not supported');
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      
      setTimeout(() => {
        setCopied(false);
      }, timeout);
      
      return true;
    } catch (error) {
      console.error('Failed to copy text: ', error);
      setCopied(false);
      return false;
    }
  };

  const reset = () => {
    setCopied(false);
  };

  return {
    copied,
    copy,
    reset,
  };
}
