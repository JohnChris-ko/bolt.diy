import { DockerManager } from './docker-manager';
import { PortInfo } from './types';
import * as http from 'http';

export class PortManager {
  private dockerManager: DockerManager;
  private monitoredSessions: Map<string, Set<number>> = new Map();
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private readonly POLL_INTERVAL = 5000; // 5 seconds
  private readonly CONNECTION_TEST_TIMEOUT = 2000; // 2 seconds

  constructor(dockerManager: DockerManager) {
    this.dockerManager = dockerManager;
  }

  startMonitoring(sessionId: string): void {
    if (this.pollIntervals.has(sessionId)) {
      return; // Already monitoring
    }

    const interval = setInterval(async () => {
      try {
        const detectedPorts = await this.dockerManager.detectPorts(sessionId);
        const currentPorts = this.monitoredSessions.get(sessionId) || new Set();

        // Check for new ports
        const newPorts: number[] = [];
        for (const port of detectedPorts) {
          if (!currentPorts.has(port)) {
            // Verify the port with connection test
            const containerIP = await this.dockerManager.getContainerIP(sessionId);
            const isResponding = await this.testConnection(containerIP, port);

            if (isResponding) {
              newPorts.push(port);
              currentPorts.add(port);
            }
          }
        }

        if (newPorts.length > 0) {
          this.monitoredSessions.set(sessionId, currentPorts);
          console.log(`[PortManager] New ports detected for session ${sessionId}:`, newPorts);
        }
      } catch (error: any) {
        console.error(`[PortManager] Monitoring failed for session ${sessionId}:`, error.message);
      }
    }, this.POLL_INTERVAL);

    this.pollIntervals.set(sessionId, interval);
    this.monitoredSessions.set(sessionId, new Set());
  }

  stopMonitoring(sessionId: string): void {
    const interval = this.pollIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(sessionId);
    }
    this.monitoredSessions.delete(sessionId);
  }

  getDetectedPorts(sessionId: string): PortInfo[] {
    const ports = this.monitoredSessions.get(sessionId);
    if (!ports || ports.size === 0) {
      return [];
    }

    const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';

    return Array.from(ports).map(port => ({
      port,
      proxyUrl: `${backendUrl}/preview/${sessionId}/${port}`,
      detected: new Date().toISOString(),
    }));
  }

  private async testConnection(containerIP: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          host: containerIP,
          port,
          path: '/',
          method: 'GET',
          timeout: this.CONNECTION_TEST_TIMEOUT,
        },
        (res) => {
          resolve(true);
          res.resume(); // Consume response
        }
      );

      req.on('error', () => {
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }
}
