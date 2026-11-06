/** 逐条执行浏览器发布，当前任务完成后推进队列。 */
export function createPublishTaskQueue(runTask) {
  const queue = [];
  let running = false;

  function runNextTask() {
    if (running || queue.length === 0) return;
    const { data, transport, onFinish } = queue.shift();
    running = true;
    let finished = false;
    runTask(data, transport, () => {
      if (finished) return;
      finished = true;
      try {
        if (typeof onFinish === "function") onFinish();
      } finally {
        running = false;
        runNextTask();
      }
    });
  }

  return function enqueue(data, transport, onFinish) {
    queue.push({ data, transport, onFinish });
    runNextTask();
  };
}
