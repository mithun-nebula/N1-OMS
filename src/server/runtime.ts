import { buildDemoWorld, type DemoWorld } from "./bootstrap";

const globalForSpine = globalThis as unknown as {
  __orgSpineWorld?: DemoWorld;
};

export function getWorld(): DemoWorld {
  if (!globalForSpine.__orgSpineWorld) {
    globalForSpine.__orgSpineWorld = buildDemoWorld();
  }
  return globalForSpine.__orgSpineWorld;
}

export function getSpine() {
  return getWorld().spine;
}
