import { useState, useEffect, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Linking from 'expo-linking';
import { TransientSharePayload, parseTransientSharePayload } from './transientSharePayload';

/**
 * Hook for managing TransientSharePayload in volatile React state. (Issue #65 — Step 8A)
 *
 * PRIVACY GUARANTEES:
 * 1. Payload lives strictly in volatile React component state.
 * 2. Calling dismiss() sets state to null and purges payload from memory.
 * 3. ZERO network calls, ZERO persistence.
 */
export function useTransientShareIntent(initialRawInput?: string, initialSubject?: string) {
  const [payload, setPayload] = useState<TransientSharePayload | null>(() => {
    if (initialRawInput) {
      return parseTransientSharePayload(initialRawInput, initialSubject, {
        source: 'initial',
        appStateAtArrival: AppState.currentState,
      });
    }
    return null;
  });

  // Handle incoming linking events (deep links or intent URLs)
  useEffect(() => {
    let isMounted = true;

    // Check initial launch URL if present (cold launch)
    Linking.getInitialURL().then((url) => {
      if (!isMounted || !url) return;
      try {
        const currentAppState = AppState.currentState;
        const parsed = Linking.parse(url);
        const sharedText = (parsed.queryParams?.text as string) || (parsed.queryParams?.url as string);
        const sharedSubject = parsed.queryParams?.subject as string;
        if (sharedText) {
          setPayload(
            parseTransientSharePayload(sharedText, sharedSubject, {
              source: 'initial',
              appStateAtArrival: currentAppState,
            })
          );
        }
      } catch (_e) {
        // Ignore malformed links
      }
    });

    // Subscriptions for incoming links while app is open (warm launch / background or foreground event)
    const subscription = Linking.addEventListener('url', (event) => {
      if (!isMounted || !event?.url) return;
      try {
        const currentAppState = AppState.currentState;
        const parsed = Linking.parse(event.url);
        const sharedText = (parsed.queryParams?.text as string) || (parsed.queryParams?.url as string);
        const sharedSubject = parsed.queryParams?.subject as string;
        if (sharedText) {
          setPayload(
            parseTransientSharePayload(sharedText, sharedSubject, {
              source: 'event',
              appStateAtArrival: currentAppState,
            })
          );
        }
      } catch (_e) {
        // Ignore malformed links
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  const setShareInput = useCallback((rawInput: string, subject?: string) => {
    setPayload(
      parseTransientSharePayload(rawInput, subject, {
        source: 'initial',
        appStateAtArrival: AppState.currentState,
      })
    );
  }, []);

  const dismiss = useCallback(() => {
    setPayload(null);
  }, []);

  return {
    payload,
    setShareInput,
    dismiss,
  };
}
