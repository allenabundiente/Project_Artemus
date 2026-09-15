// Tiny pub/sub so purchase celebrations can drive every coin HUD (dashboard,
// shop header) without prop-drilling a callback through screens.
//
// `bumpHudCoins(balance)` is fired by the treasure-drop celebration; HUDs
// subscribe with onHudCoins, show the new balance, and pulse via .coin-bump.

type Listener = (coins: number) => void;

const listeners = new Set<Listener>();

export function bumpHudCoins(coins: number): void {
  for (const l of listeners) l(coins);
}

export function onHudCoins(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
