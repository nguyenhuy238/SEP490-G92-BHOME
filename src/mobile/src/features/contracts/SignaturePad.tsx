import React, { useRef, useState } from 'react';
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { Button, Text } from 'react-native-paper';
import type { DrawnSignature } from '../../../../../packages/client-core/src/signing';

type Point = [number, number];

// Signature drawn with a finger: the strokes are kept as points and drawn as short rotated bars, so no native drawing
// library is needed. The server turns the same points into the signer's transparent PNG
// (POST /digital-signing/signature-image/drawn).
export function SignaturePad({
  onChange,
  disabled,
  height = 170,
}: {
  onChange: (drawing: DrawnSignature | null) => void;
  disabled?: boolean;
  height?: number;
}) {
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [width, setWidth] = useState(0);
  const current = useRef<Point[] | null>(null);
  // The strokes as drawn so far; state only drives rendering.
  const all = useRef<Point[][]>([]);

  const point = (e: GestureResponderEvent): Point => [
    Math.round(Math.min(Math.max(0, e.nativeEvent.locationX), width) * 10) / 10,
    Math.round(Math.min(Math.max(0, e.nativeEvent.locationY), height) * 10) / 10,
  ];
  const publish = (next: Point[][]) => {
    all.current = next;
    setStrokes(next);
    const points = next.reduce((n, s) => n + s.length, 0);
    onChange(
      points >= 5 && width > 0
        ? { width: Math.round(width), height: Math.round(height), strokes: thin(next) }
        : null,
    );
  };
  const handlers = {
    onStartShouldSetResponder: () => !disabled,
    onMoveShouldSetResponder: () => !disabled,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      current.current = [point(e)];
      all.current = [...all.current, current.current];
      setStrokes(all.current);
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const stroke = current.current;
      if (!stroke) return;
      const p = point(e);
      const last = stroke[stroke.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
      stroke.push(p);
      all.current = [...all.current.slice(0, -1), [...stroke]];
      setStrokes(all.current);
    },
    onResponderRelease: () => {
      current.current = null;
      publish(all.current);
    },
  };

  return (
    <View>
      <View
        {...handlers}
        accessibilityLabel="Khung ký tên: ký bằng ngón tay"
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={{
          height,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: '#9a9a9a',
          borderRadius: 12,
          backgroundColor: '#fff',
          overflow: 'hidden',
        }}
      >
        {strokes.map((stroke, i) =>
          stroke.slice(1).map((p, j) => <Segment key={`${i}-${j}`} from={stroke[j]} to={p} />),
        )}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 18,
            right: 18,
            bottom: 30,
            borderTopWidth: 1,
            borderColor: '#ddd',
          }}
        />
        {!strokes.length && (
          <Text
            pointerEvents="none"
            style={{
              position: 'absolute',
              bottom: 8,
              alignSelf: 'center',
              color: '#9a9a9a',
              fontSize: 12,
            }}
          >
            Ký bằng ngón tay trong khung
          </Text>
        )}
      </View>
      <Button disabled={disabled || !strokes.length} onPress={() => publish([])}>
        Xoá và vẽ lại
      </Button>
    </View>
  );
}

// One short bar between two points, rotated around its centre.
function Segment({ from, to }: { from: Point; to: Point }) {
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  const length = Math.max(1, Math.hypot(dx, dy));
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (from[0] + to[0]) / 2 - length / 2,
        top: (from[1] + to[1]) / 2 - 1.5,
        width: length,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: '#0d2c8c',
        transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
      }}
    />
  );
}

// The server accepts at most 8000 points: keep every n-th point of very long drawings (stroke ends are kept).
function thin(strokes: Point[][]): Point[][] {
  const total = strokes.reduce((n, s) => n + s.length, 0);
  const step = Math.ceil(total / 7000);
  if (step <= 1) return strokes;
  return strokes.map((s) => s.filter((_, i) => i % step === 0 || i === s.length - 1));
}
