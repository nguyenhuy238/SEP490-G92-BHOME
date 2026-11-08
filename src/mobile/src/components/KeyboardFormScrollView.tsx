import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Keyboard, ScrollView, type ScrollViewProps } from 'react-native';

// Uses the existing native ScrollView responder, including inside fullscreen Modals.
// Coordinates come from the focused native input rather than fixed screen/keyboard heights.
type ScrollHandle = React.ComponentRef<typeof ScrollView>;
export const KeyboardFormScrollView = forwardRef<ScrollHandle, ScrollViewProps>(
  function KeyboardFormScrollView(props, ref) {
    const scroll = useRef<ScrollHandle>(null);
    const focused = useRef<
      Parameters<ScrollHandle['scrollResponderScrollNativeHandleToKeyboard']>[0] | null
    >(null);
    const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
    useImperativeHandle(ref, () => scroll.current!, []);
    const reveal = useCallback(() => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (focused.current !== null)
          scroll.current?.scrollResponderScrollNativeHandleToKeyboard(focused.current, 24, true);
      });
    }, []);
    useEffect(() => {
      const listener = Keyboard.addListener('keyboardDidShow', reveal);
      return () => {
        listener.remove();
        if (frame.current !== null) cancelAnimationFrame(frame.current);
      };
    }, [reveal]);
    return (
      <ScrollView
        {...props}
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={false}
        onFocusCapture={(event) => {
          focused.current = event.nativeEvent.target;
          reveal();
          props.onFocusCapture?.(event);
        }}
      />
    );
  },
);
