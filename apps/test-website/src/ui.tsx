import React, { ReactElement, useEffect } from 'react';

const useAnimationFrame = (callback) => {
  // Use useRef for mutable variables that we want to persist
  // without triggering a re-render on their change
  const requestRef = React.useRef();
  const previousTimeRef = React.useRef();

  const animate = (time) => {
    if (previousTimeRef.current != undefined) {
      const deltaTime = time - previousTimeRef.current;
      callback(deltaTime);
    }
    previousTimeRef.current = time;
    requestRef.current = requestAnimationFrame(animate);
  };

  React.useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, []); // Make sure the effect runs only once
};

export function Main(): React.ReactElement {
  const [startTime, setStartTime] = React.useState(0);
  const [count, setCount] = React.useState(0);
  const [deltas, setDeltas] = React.useState<number[]>([]);
  React.useEffect(() => {
    setStartTime(performance.now());
  }, []);
  useAnimationFrame((deltaTime) => {
    setCount((count) => count + 1);
    setDeltas((prevDeltas) => {
      prevDeltas.push(deltaTime);
      return prevDeltas;
    });
  });
  const now = performance.now();
  const time = (now - startTime) / 1000;
  return (
    <div>
      Performed {count} updates within {time}s
    </div>
  );
}
