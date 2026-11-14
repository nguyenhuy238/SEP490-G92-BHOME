import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { ScrollLockContext } from './ScrollLock';
import {
  Keyboard,
  ScrollView,
  UIManager,
  type KeyboardEvent,
  type ScrollViewProps,
} from 'react-native';

// Uses the existing native ScrollView responder, including inside fullscreen Modals.
// Coordinates come from the focused native input rather than fixed screen/keyboard heights.
type ScrollHandle = React.ComponentRef<typeof ScrollView>;
export const KeyboardFormScrollView = forwardRef<ScrollHandle, ScrollViewProps>(
  function KeyboardFormScrollView(props, ref) {
    const scroll = useRef<ScrollHandle>(null);
    const focused = useRef<number | null>(null);
    const keyboardTop = useRef<number | null>(null);
    const scrollY = useRef(0);
    const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
    useImperativeHandle(ref, () => scroll.current!, []);
    // A drawing child (signature pad) locks scrolling while the finger is down.
    const [locked, setLocked] = useState(false);
    const reveal = useCallback(() => {
      if (focused.current === null || keyboardTop.current === null) return;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        // KeyboardAvoidingView changes the viewport first. Measure afterwards,
        // then move only the covered distance so the field remains visible.
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          const target = focused.current;
          const top = keyboardTop.current;
          if (target === null || top === null) return;
          UIManager.measureInWindow(target, (_x, y, _width, height) => {
            const covered = y + height + 16 - top;
            if (covered > 0)
              scroll.current?.scrollTo({
                y: Math.max(0, scrollY.current + covered),
                animated: true,
              });
          });
        });
      });
    }, []);
    useEffect(() => {
      const opened = (event: KeyboardEvent) => {
        keyboardTop.current = event.endCoordinates.screenY;
        reveal();
      };
      const show = Keyboard.addListener('keyboardDidShow', opened);
      const resize = Keyboard.addListener('keyboardDidChangeFrame', opened);
      const hide = Keyboard.addListener('keyboardDidHide', () => {
        keyboardTop.current = null;
      });
      return () => {
        show.remove();
        resize.remove();
        hide.remove();
        if (frame.current !== null) cancelAnimationFrame(frame.current);
      };
    }, [reveal]);
    return (
      <ScrollLockContext.Provider value={setLocked}>
        <ScrollView
          {...props}
          scrollEnabled={!locked && props.scrollEnabled !== false}
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets={false}
          onFocusCapture={(event) => {
            focused.current = event.nativeEvent.target;
            reveal();
            props.onFocusCapture?.(event);
          }}
          onScroll={(event) => {
            scrollY.current = event.nativeEvent.contentOffset.y;
            props.onScroll?.(event);
          }}
          scrollEventThrottle={props.scrollEventThrottle ?? 16}
        />
      </ScrollLockContext.Provider>
    );
  },
);
