export function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

const tasks = [
  { label: 'Review changes', done: false },
  { label: 'Run checks', done: true },
];

export const pendingTasks = tasks
  .filter(task => !task.done)
  .map(task => normalizeLabel(task.label));
