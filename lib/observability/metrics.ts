import { env } from "../env";

export type MetricTags = Record<string, string | number | boolean>;

type CounterStore = Map<string, number>;
type HistogramStore = Map<string, number[]>;

declare global {
  // eslint-disable-next-line no-var
  var __hookforgeCounters: CounterStore | undefined;
  // eslint-disable-next-line no-var
  var __hookforgeHistograms: HistogramStore | undefined;
}

function counters() {
  if (!global.__hookforgeCounters) {
    global.__hookforgeCounters = new Map<string, number>();
  }
  return global.__hookforgeCounters;
}

function histograms() {
  if (!global.__hookforgeHistograms) {
    global.__hookforgeHistograms = new Map<string, number[]>();
  }
  return global.__hookforgeHistograms;
}

function key(name: string, tags?: MetricTags) {
  if (!tags) {
    return `${env.METRICS_NAMESPACE}.${name}`;
  }
  const suffix = Object.entries(tags)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(",");
  return `${env.METRICS_NAMESPACE}.${name}|${suffix}`;
}

export const metrics = {
  increment(name: string, value = 1, tags?: MetricTags) {
    const metricKey = key(name, tags);
    const next = (counters().get(metricKey) ?? 0) + value;
    counters().set(metricKey, next);
    return next;
  },
  observe(name: string, value: number, tags?: MetricTags) {
    const metricKey = key(name, tags);
    const bucket = histograms().get(metricKey) ?? [];
    bucket.push(value);
    histograms().set(metricKey, bucket);
    return bucket.length;
  },
  snapshot() {
    return {
      counters: Object.fromEntries(counters().entries()),
      histograms: Object.fromEntries(histograms().entries())
    };
  }
};
