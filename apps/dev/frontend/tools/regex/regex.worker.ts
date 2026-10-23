import { runRegex } from './regex-engine';
import type { RegexRequest } from './regex-engine';

// The pattern is tried away from the window: one that takes long (a pattern can take longer than anyone waits)
// leaves the program free, and is ended by ending this worker.
self.onmessage = (event: MessageEvent<RegexRequest>) => {
  self.postMessage(runRegex(event.data));
};
