
import { useState, useCallback } from 'react';

export interface UseLoadingReturn {
  loading: boolean;
  setLoading: (loading: boolean) => void;
  withLoading: <T extends any[], R>(
    fn: (...args: T) => Promise<R>
  ) => (...args: T) => Promise<R>;
}

export function useLoading(initialLoading = false): UseLoadingReturn {
  const [loading, setLoading] = useState(initialLoading);

  const withLoading = useCallback(
    <T extends any[], R>(fn: (...args: T) => Promise<R>) =>
      async (...args: T): Promise<R> => {
        setLoading(true);
        try {
          const result = await fn(...args);
          return result;
        } finally {
          setLoading(false);
        }
      },
    []
  );

  return {
    loading,
    setLoading,
    withLoading,
  };
}
