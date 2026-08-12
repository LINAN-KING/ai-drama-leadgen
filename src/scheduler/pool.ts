export async function runPool<T, R>(
  items: T[],
  concurrency: () => number,
  worker: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;
  const active = new Set<Promise<void>>();
  const launch = (index: number) => {
    const promise = worker(items[index] as T)
      .then(
        (value) => {
          results[index] = { status: "fulfilled", value };
        },
        (reason) => {
          results[index] = { status: "rejected", reason };
        },
      )
      .finally(() => active.delete(promise));
    active.add(promise);
  };
  while (next < items.length || active.size) {
    while (next < items.length && active.size < concurrency()) launch(next++);
    if (active.size) await Promise.race(active);
  }
  return results;
}
