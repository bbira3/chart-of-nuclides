import { solveBateman, type SimInput } from './bateman';

self.onmessage = (e: MessageEvent<{ id: number; input: SimInput }>) => {
  const { id, input } = e.data;
  try {
    const out = solveBateman(input);
    (self as unknown as Worker).postMessage(
      { id, out },
      [...out.atoms.map(a => a.buffer), ...out.activity.map(a => a.buffer)],
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
