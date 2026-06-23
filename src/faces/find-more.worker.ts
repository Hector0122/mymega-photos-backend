import { parentPort, workerData } from 'worker_threads';

interface WorkerInput {
  confirmedEncodings: number[][];
  unconfirmedEncodings: number[][];
  threshold: number;
}

interface MatchResult {
  index: number;
  distance: number;
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function run(input: WorkerInput): void {
  const { confirmedEncodings, unconfirmedEncodings, threshold } = input;
  const matches: MatchResult[] = [];

  for (let i = 0; i < unconfirmedEncodings.length; i++) {
    const encoding = unconfirmedEncodings[i];
    let minDistance = Infinity;

    for (const refEncoding of confirmedEncodings) {
      const dist = euclideanDistance(encoding, refEncoding);
      if (dist < minDistance) minDistance = dist;
    }

    if (minDistance < threshold) {
      matches.push({
        index: i,
        distance: Math.round(minDistance * 1000) / 1000,
      });
    }
  }

  parentPort?.postMessage(matches);
}

try {
  run(workerData as WorkerInput);
} catch (err) {
  parentPort?.postMessage({ error: (err as Error).message });
}
