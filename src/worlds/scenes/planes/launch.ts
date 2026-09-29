/**
 * Tiny event bus: the contact form calls launchPlane() when a message is
 * sent, and the planes scene flies a hero plane from the form toward the
 * horizon. Launches fired while the scene is not mounted play once it mounts.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let pending = 0;

export function launchPlane() {
  if (listeners.size === 0) {
    pending = Math.min(pending + 1, 1);
    return;
  }
  for (const fn of listeners) fn();
}

export function onLaunch(fn: Listener): () => void {
  listeners.add(fn);
  if (pending) {
    pending = 0;
    fn();
  }
  return () => {
    listeners.delete(fn);
  };
}
