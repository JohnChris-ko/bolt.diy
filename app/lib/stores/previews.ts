import { atom } from 'nanostores';
import type { DockerRuntime } from '~/lib/docker';

export interface PreviewInfo {
  port: number;
  ready: boolean;
  baseUrl: string;
}

export class PreviewsStore {
  #availablePreviews = new Map<number, PreviewInfo>();
  #dockerRuntimePromise: Promise<DockerRuntime>;
  private pollingInterval: NodeJS.Timeout | null = null;

  previews = atom<PreviewInfo[]>([]);

  constructor(dockerRuntimePromise: Promise<any>) {
    this.#dockerRuntimePromise = dockerRuntimePromise;
  }

  public async startPolling() {
    if (this.pollingInterval) return;

    const dockerRuntime = await this.#dockerRuntimePromise;
    const sessionId = dockerRuntime.sessionId;

    if (!sessionId) {
        console.error("No session ID available for polling previews.");
        return;
    };

    this.pollingInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/preview/${sessionId}`);
        if (response.ok) {
          const data = await response.json();
          const { previewUrl } = data;

          if (previewUrl) {
            const url = new URL(previewUrl);
            const port = parseInt(url.port);

            let previewInfo = this.#availablePreviews.get(port);
            if (!previewInfo) {
              previewInfo = { port, ready: true, baseUrl: previewUrl };
              this.#availablePreviews.set(port, previewInfo);
            } else {
              previewInfo.ready = true;
              previewInfo.baseUrl = previewUrl;
            }
            this.previews.set([...this.#availablePreviews.values()]);
          }
        } else {
            if (this.#availablePreviews.size > 0) {
                this.#availablePreviews.clear();
                this.previews.set([]);
            }
        }
      } catch (error) {
        if (this.#availablePreviews.size > 0) {
            this.#availablePreviews.clear();
            this.previews.set([]);
        }
      }
    }, 2000);
  }

  public stopPolling() {
      if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
      }
  }

  refreshAllPreviews() {
    // This is now handled by vite HMR inside the container.
  }
}
