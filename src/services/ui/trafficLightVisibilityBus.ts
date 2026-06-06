type TrafficLightVisibilityListener = (visible: boolean) => void;

let visible = true;
const listeners = new Set<TrafficLightVisibilityListener>();

export const trafficLightVisibilityBus = {
  getVisible(): boolean {
    return visible;
  },

  setVisible(nextVisible: boolean): void {
    if (visible === nextVisible) {
      return;
    }

    visible = nextVisible;
    for (const listener of listeners) {
      listener(visible);
    }
  },

  subscribe(listener: TrafficLightVisibilityListener): () => void {
    listeners.add(listener);
    listener(visible);
    return () => {
      listeners.delete(listener);
    };
  },
};
